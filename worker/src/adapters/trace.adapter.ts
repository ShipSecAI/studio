import { ITraceService, TraceEvent } from '@shipsec/component-sdk';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { workflowTraces } from './schema';
import * as schema from './schema';

/**
 * Trace adapter that keeps an in-memory view for local reads and optionally persists
 * events to PostgreSQL via Drizzle when a database instance is provided.
 */
export class TraceAdapter implements ITraceService {
  private readonly eventsByRun = new Map<string, TraceEvent[]>();
  private readonly sequenceByRun = new Map<string, number>();
  private readonly metadataByRun = new Map<string, { workflowId?: string }>();

  constructor(private readonly db?: NodePgDatabase<typeof schema>) {}

  record(event: TraceEvent): void {
    const list = this.eventsByRun.get(event.runId) ?? [];
    list.push(event);
    this.eventsByRun.set(event.runId, list);

    const context =
      event.message !== undefined ? `${event.type} - ${event.nodeRef}: ${event.message}` : `${event.type} - ${event.nodeRef}`;
    console.log(`[TRACE][${event.level}] ${context}`);

    if (!this.db) {
      return;
    }

    const sequence = this.nextSequence(event.runId);
    void this.persist(event, sequence).catch((error) => {
      console.error('[TRACE] Failed to persist trace event', error);
    });
  }

  getEvents(runId: string): TraceEvent[] {
    return this.eventsByRun.get(runId) ?? [];
  }

  clear(): void {
    this.eventsByRun.clear();
    this.sequenceByRun.clear();
    this.metadataByRun.clear();
  }

  setRunMetadata(runId: string, metadata: { workflowId?: string }): void {
    this.metadataByRun.set(runId, metadata);
  }

  finalizeRun(runId: string): void {
    this.eventsByRun.delete(runId);
    this.sequenceByRun.delete(runId);
    this.metadataByRun.delete(runId);
  }

  private nextSequence(runId: string): number {
    const current = this.sequenceByRun.get(runId) ?? 0;
    const next = current + 1;
    this.sequenceByRun.set(runId, next);
    return next;
  }

  private async persist(event: TraceEvent, sequence: number): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.insert(workflowTraces).values({
      runId: event.runId,
      workflowId: this.metadataByRun.get(event.runId)?.workflowId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: new Date(event.timestamp),
      message: event.message ?? null,
      error: event.error ?? null,
      outputSummary: event.outputSummary ?? null,
      level: event.level,
      data: event.data ?? null,
      sequence,
    });
  }
}
