import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ServiceError } from '@shipsec/component-sdk';

import { workflowLogStreams } from './schema';
import type * as schema from './schema';
import type { WorkflowLogEntry, WorkflowLogSink } from '../temporal/types';

export interface LokiLogClientConfig {
  baseUrl: string;
  tenantId?: string;
  username?: string;
  password?: string;
}

export interface LokiStreamLine {
  message: string;
  timestamp: Date;
}

export interface LokiPushClient {
  push(labels: Record<string, string>, lines: LokiStreamLine[]): Promise<void>;
}

export class LokiLogClient implements LokiPushClient {
  constructor(private readonly config: LokiLogClientConfig) {}

  async push(labels: Record<string, string>, lines: LokiStreamLine[]): Promise<void> {
    if (lines.length === 0) {
      return;
    }

    const url = this.resolveUrl('/loki/api/v1/push');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.tenantId) {
      headers['X-Scope-OrgID'] = this.config.tenantId;
    }

    if (this.config.username && this.config.password) {
      const credentials = Buffer.from(
        `${this.config.username}:${this.config.password}`,
      ).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    }

    const body = JSON.stringify({
      streams: [
        {
          stream: labels,
          values: lines.map((line) => [this.toNanoseconds(line.timestamp), line.message]),
        },
      ],
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceError(
        `Loki push failed: ${errorText}`,
        {
          statusCode: response.status,
          details: { statusText: response.statusText, errorText },
        },
      );
    }
  }

  private resolveUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private toNanoseconds(date: Date): string {
    return (BigInt(date.getTime()) * 1000000n).toString();
  }
}

export class LokiLogAdapter implements WorkflowLogSink {
  constructor(
    private readonly client: LokiPushClient,
    private readonly db?: NodePgDatabase<typeof schema>,
  ) {}
  private ensureIndexPromise?: Promise<void>;

  async append(entry: WorkflowLogEntry): Promise<void> {
    if (!entry.message || entry.message.trim().length === 0) {
      return;
    }

    const timestamp = entry.timestamp ?? new Date();
    const labels = this.buildLabels(entry);
    const lines = this.buildLines(entry.message, timestamp);
    const lineCount = lines.length;

    try {
      await this.client.push(labels, lines);
    } catch (error) {
      console.error('[LOKI] Failed to push log entry', error);
      return;
    }

    if (this.db) {
      await this.persistMetadata({
        runId: entry.runId,
        nodeRef: entry.nodeRef,
        stream: entry.stream,
        labels,
        lineCount,
        timestamp,
        organizationId: entry.organizationId ?? null,
      });
    }
  }

  private buildLabels(entry: WorkflowLogEntry): Record<string, string> {
    const labels: Record<string, string> = {
      run_id: entry.runId,
      node: entry.nodeRef,
      stream: entry.stream,
    };

    if (entry.level) {
      labels.level = entry.level;
    }

    if (entry.metadata?.activityId) {
      labels.activity_id = entry.metadata.activityId;
    }

    if (entry.metadata?.attempt !== undefined) {
      labels.attempt = String(entry.metadata.attempt);
    }

    if (entry.metadata?.correlationId) {
      labels.correlation_id = entry.metadata.correlationId;
    }

    if (entry.metadata?.streamId) {
      labels.stream_id = entry.metadata.streamId;
    }

    if (entry.metadata?.joinStrategy) {
      labels.join_strategy = entry.metadata.joinStrategy;
    }

    if (entry.metadata?.triggeredBy) {
      labels.triggered_by = entry.metadata.triggeredBy;
    }

    return labels;
  }

  private buildLines(message: string, timestamp: Date): LokiStreamLine[] {
    const segments = message.split(/\r?\n/);
    return segments
      .map((segment) => segment.trimEnd())
      .filter((segment) => segment.length > 0)
      .map((segment, index) => ({
        message: segment,
        timestamp: index === 0 ? timestamp : new Date(timestamp.getTime() + index),
      }));
  }

  private async persistMetadata(input: {
    runId: string;
    nodeRef: string;
    stream: WorkflowLogEntry['stream'];
    labels: Record<string, string>;
    lineCount: number;
    timestamp: Date;
    organizationId?: string | null;
  }): Promise<void> {
    if (!this.db) {
      return;
    }

    const now = new Date();

    const values = {
      runId: input.runId,
      nodeRef: input.nodeRef,
      stream: input.stream,
      labels: input.labels,
      organizationId: input.organizationId ?? null,
      firstTimestamp: input.timestamp,
      lastTimestamp: input.timestamp,
      lineCount: input.lineCount,
      updatedAt: now,
    };

    const upsert = async () => {
      await this.db!
        .insert(workflowLogStreams)
        .values(values)
        .onConflictDoUpdate({
          target: [
            workflowLogStreams.runId,
            workflowLogStreams.nodeRef,
            workflowLogStreams.stream,
          ],
          set: {
            labels: input.labels,
            lastTimestamp: input.timestamp,
            firstTimestamp: sql`LEAST(${workflowLogStreams.firstTimestamp}, ${input.timestamp})`,
            lineCount: sql`${workflowLogStreams.lineCount} + ${input.lineCount}`,
            updatedAt: now,
          },
        });
    };

    try {
      await upsert();
    } catch (error: any) {
      if (error?.code === '42P10') {
        await this.ensureUniqueIndex();
        await upsert();
        return;
      }

      throw error;
    }
  }

  private async ensureUniqueIndex(): Promise<void> {
    if (!this.db) {
      return;
    }

    if (!this.ensureIndexPromise) {
      this.ensureIndexPromise = (async () => {
        await this.db!.execute(sql`
          WITH ranked_streams AS (
            SELECT
              id,
              ROW_NUMBER() OVER (
                PARTITION BY run_id, node_ref, stream
                ORDER BY id
              ) AS row_number
            FROM workflow_log_streams
          )
          DELETE FROM workflow_log_streams
          WHERE id IN (
            SELECT id
            FROM ranked_streams
            WHERE row_number > 1
          );
        `);

        await this.db!.execute(sql`
          CREATE UNIQUE INDEX IF NOT EXISTS workflow_log_streams_run_node_stream_uidx
          ON workflow_log_streams (run_id, node_ref, stream);
        `);
      })().catch((error) => {
        this.ensureIndexPromise = undefined;
        throw error;
      });
    }

    await this.ensureIndexPromise;
  }
}
