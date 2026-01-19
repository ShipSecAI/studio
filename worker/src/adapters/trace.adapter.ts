import { ITraceService, TraceEvent } from '@shipsec/component-sdk';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { workflowTraces } from './schema';
import * as schema from './schema';

/**
 * Trace adapter that optionally buffers trace events in-memory for local reads and
 * can persist events to PostgreSQL via Drizzle when a database instance is provided.
 */
export class TraceAdapter implements ITraceService {
  private readonly bufferEnabled: boolean;
  private readonly eventsByRun: Map<string, TraceEvent[]> | undefined;
  private readonly sequenceByRun = new Map<string, number>();
  private readonly metadataByRun = new Map<
    string,
    { workflowId?: string; organizationId?: string | null }
  >();
  private readonly logger: Pick<Console, 'log' | 'error'>;

  constructor(
    private readonly db?: NodePgDatabase<typeof schema>,
    options: {
      buffer?: boolean;
      logger?: Pick<Console, 'log' | 'error'>;
    } = {},
  ) {
    this.bufferEnabled = options.buffer ?? false;
    this.eventsByRun = this.bufferEnabled ? new Map<string, TraceEvent[]>() : undefined;
    this.logger = options.logger ?? console;
  }

  record(event: TraceEvent): void {
    if (this.bufferEnabled && this.eventsByRun) {
      const list = this.eventsByRun.get(event.runId) ?? [];
      list.push(event);
      this.eventsByRun.set(event.runId, list);
    }

    const context =
      event.message !== undefined
        ? `${event.type} - ${event.nodeRef}: ${event.message}`
        : `${event.type} - ${event.nodeRef}`;
    this.logger.log(`[TRACE][${event.level}] ${context}`);

    if (!this.db) {
      return;
    }

    const sequence = this.nextSequence(event.runId);
    void this.persist(event, sequence).catch((error) => {
      this.logger.error('[TRACE] Failed to persist trace event', error);
    });
  }

  getEvents(runId: string): TraceEvent[] {
    if (!this.bufferEnabled || !this.eventsByRun) {
      return [];
    }
    return this.eventsByRun.get(runId) ?? [];
  }

  clear(): void {
    if (this.eventsByRun) {
      this.eventsByRun.clear();
    }
    this.sequenceByRun.clear();
    this.metadataByRun.clear();
  }

  setRunMetadata(
    runId: string,
    metadata: { workflowId?: string; organizationId?: string | null },
  ): void {
    this.metadataByRun.set(runId, metadata);
  }

  finalizeRun(runId: string): void {
    if (this.eventsByRun) {
      this.eventsByRun.delete(runId);
    }
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

    const packedData = this.packData(event);

    await this.db.insert(workflowTraces).values({
      runId: event.runId,
      workflowId: this.metadataByRun.get(event.runId)?.workflowId ?? null,
      organizationId: this.metadataByRun.get(event.runId)?.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: new Date(event.timestamp),
      message: event.message ?? null,
      error: event.error ?? null,
      outputSummary: event.outputSummary ?? null,
      level: event.level,
      data: packedData,
      sequence,
    });
  }

  private packData(event: TraceEvent): Record<string, unknown> | null {
    const hasData = event.data && typeof event.data === 'object' && !Array.isArray(event.data);
    const hasMetadata =
      event.context && typeof event.context === 'object' && !Array.isArray(event.context);

    if (!hasData && !hasMetadata) {
      return null;
    }

    const packed: Record<string, unknown> = {};

    if (hasData) {
      packed._payload = { ...(event.data as Record<string, unknown>) };
    }

    if (hasMetadata) {
      packed._metadata = {
        ...(event.context as unknown as Record<string, unknown>),
      };
    }

    return packed;
  }
}
