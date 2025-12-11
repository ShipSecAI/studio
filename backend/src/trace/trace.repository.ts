import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  workflowTracesTable,
  type WorkflowTraceRecord,
} from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';
import type { TraceEventType } from './types';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

export interface PersistedTraceEvent {
  runId: string;
  workflowId?: string;
  organizationId?: string | null;
  type: TraceEventType;
  nodeRef: string;
  timestamp: string;
  sequence: number;
  level: string;
  message?: string;
  error?: string;
  outputSummary?: unknown;
  data?: Record<string, unknown> | null;
}

@Injectable()
export class TraceRepository implements OnModuleDestroy {
  private pool: Pool;

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {
    // Create a separate pool for LISTEN/NOTIFY to avoid conflicts
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /**
   * Subscribe to real-time trace events for a specific run ID using Postgres LISTEN/NOTIFY
   */
  async subscribeToRun(runId: string, callback: (payload: string) => void): Promise<() => Promise<void>> {
    const client = await this.pool.connect();
    const channel = `trace_events_${runId}`;

    try {
      await client.query(`LISTEN "${channel}"`);

      client.on('notification', (msg) => {
        if (msg.channel === channel && msg.payload) {
          callback(msg.payload);
        }
      });

      // Return unsubscribe function
      return async () => {
        try {
          await client.query(`UNLISTEN "${channel}"`);
        } finally {
          client.release();
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Notify subscribers of new trace events
   */
  async notifyRun(runId: string, payload: string): Promise<void> {
    const channel = `trace_events_${runId}`;
    await this.pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
  }

  async append(event: PersistedTraceEvent): Promise<void> {
    await this.db.insert(workflowTracesTable).values(this.mapToInsert(event));

    // Notify subscribers of the new trace event
    try {
      const payload = JSON.stringify({
        sequence: event.sequence,
        type: event.type,
        nodeRef: event.nodeRef,
        timestamp: event.timestamp,
      });
      await this.notifyRun(event.runId, payload);
    } catch (error) {
      // Log error but don't fail the append operation
      console.error('Failed to notify trace subscribers:', error);
    }
  }

  async appendMany(events: PersistedTraceEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await this.db
      .insert(workflowTracesTable)
      .values(events.map((event) => this.mapToInsert(event)));
  }

  async listByRunId(runId: string, organizationId?: string | null): Promise<WorkflowTraceRecord[]> {
    return this.db
      .select()
      .from(workflowTracesTable)
      .where(this.buildRunFilter(runId, organizationId))
      .orderBy(workflowTracesTable.sequence);
  }

  async listAfterSequence(
    runId: string,
    sequence: number,
    organizationId?: string | null,
  ): Promise<WorkflowTraceRecord[]> {
    const runFilter = this.buildRunFilter(runId, organizationId);
    return this.db
      .select()
      .from(workflowTracesTable)
      .where(
        and(
          runFilter,
          gt(workflowTracesTable.sequence, sequence),
        ),
      )
      .orderBy(workflowTracesTable.sequence);
  }

  async countByType(
    runId: string,
    type: TraceEventType,
    organizationId?: string | null,
  ): Promise<number> {
    const runFilter = this.buildRunFilter(runId, organizationId);
    const [result] = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(workflowTracesTable)
      .where(
        and(
          runFilter,
          eq(workflowTracesTable.type, type),
        ),
      );

    return Number(result?.value ?? 0);
  }

  /**
   * Get the first and last event timestamps for a run to calculate accurate duration
   */
  async getEventTimeRange(
    runId: string,
    organizationId?: string | null,
  ): Promise<{ firstTimestamp: Date | null; lastTimestamp: Date | null }> {
    const runFilter = this.buildRunFilter(runId, organizationId);
    const [result] = await this.db
      .select({
        firstTimestamp: sql<Date>`min(${workflowTracesTable.timestamp})`,
        lastTimestamp: sql<Date>`max(${workflowTracesTable.timestamp})`,
      })
      .from(workflowTracesTable)
      .where(runFilter);

    return {
      firstTimestamp: result?.firstTimestamp ?? null,
      lastTimestamp: result?.lastTimestamp ?? null,
    };
  }

  private mapToInsert(event: PersistedTraceEvent) {
    return {
      runId: event.runId,
      workflowId: event.workflowId ?? null,
      organizationId: event.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: new Date(event.timestamp),
      message: event.message ?? null,
      error: event.error ?? null,
      outputSummary: event.outputSummary ?? null,
      level: event.level,
      data: event.data ?? null,
      sequence: event.sequence,
    };
  }

  private buildRunFilter(runId: string, organizationId?: string | null) {
    const base = eq(workflowTracesTable.runId, runId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowTracesTable.organizationId, organizationId));
  }
}
