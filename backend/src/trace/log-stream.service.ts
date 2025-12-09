import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';

import { LogStreamRepository } from './log-stream.repository';
import type { WorkflowLogStreamRecord } from '../database/schema';
import type { AuthContext } from '../auth/types';

interface FetchLogsOptions {
  nodeRef?: string;
  stream?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  limit?: number;
  cursor?: string; // ISO timestamp for pagination
  startTime?: string; // ISO timestamp for time range start
  endTime?: string; // ISO timestamp for time range end
}

interface LokiEntry {
  timestamp: string;
  message: string;
  level?: string;
  nodeId?: string;
}

@Injectable()
export class LogStreamService {
  private readonly baseUrl?: string;
  private readonly tenantId?: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;

  constructor(private readonly repository: LogStreamRepository) {
    this.baseUrl = process.env.LOKI_URL;
    this.tenantId = process.env.LOKI_TENANT_ID;
    this.username = process.env.LOKI_USERNAME;
    this.password = process.env.LOKI_PASSWORD;

    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    this.kafkaTopic = process.env.LOG_KAFKA_TOPIC ?? 'telemetry.logs';
  }

  async fetch(runId: string, auth: AuthContext | null, options: FetchLogsOptions = {}) {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException('Loki integration is not configured');
    }

    const organizationId = this.requireOrganizationId(auth);
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 2000) : 500;

    // Build Loki query selector
    const selectorLabels: Record<string, string> = { run_id: runId };
    if (options.nodeRef) selectorLabels.node = options.nodeRef;
    if (options.stream) selectorLabels.stream = options.stream;
    if (options.level) selectorLabels.level = options.level;

    const selector = this.buildSelector(selectorLabels);

    // Query Loki - use time range if provided (for timeline scrubbing), otherwise use pagination
    const entries = options.startTime && options.endTime
      ? await this.queryLokiTimeRange(selector, options.startTime, options.endTime, limit)
      : await this.queryLokiRange(selector, limit, options.cursor);

    // Transform to flat log list
    const logs = entries.map((entry, index) => ({
      id: `${runId}-${entry.timestamp}-${index}`,
      runId,
      nodeId: entry.nodeId || 'unknown',
      level: entry.level || 'info',
      message: entry.message,
      timestamp: entry.timestamp,
    }));

    return {
      runId,
      logs,
      totalCount: logs.length,
      hasMore: !options.startTime && !options.endTime && logs.length === limit, // Only paginate when not using time range
      nextCursor: (!options.startTime && !options.endTime && logs.length > 0) ? logs[logs.length - 1].timestamp : undefined,
    };
  }

  async fetchRecentLogs(runId: string, lastSequence?: number): Promise<Array<{
    id: string;
    runId: string;
    nodeId: string;
    level: string;
    message: string;
    timestamp: string;
    sequence: number;
  }>> {
    if (this.kafkaBrokers.length === 0) {
      return []; // No Kafka configured, return empty
    }

    const kafka = new Kafka({
      clientId: 'log-stream-fetcher',
      brokers: this.kafkaBrokers,
    });

    const consumer = kafka.consumer({
      groupId: `log-stream-${runId}-${Date.now()}`,
      readUncommitted: false,
    });

    try {
      await consumer.connect();
      await consumer.subscribe({
        topic: this.kafkaTopic,
        fromBeginning: false
      });

      const messages: Array<{
        id: string;
        runId: string;
        nodeId: string;
        level: string;
        message: string;
        timestamp: string;
        sequence: number;
      }> = [];

      // Consume messages for a short time
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          consumer.disconnect().catch(console.error);
          resolve();
        }, 1000); // 1 second timeout

        consumer.run({
          eachMessage: async ({ message }) => {
            if (!message.value) return;

            try {
              const payload = JSON.parse(message.value.toString()) as {
                runId: string;
                nodeRef: string;
                level: string;
                message: string;
                timestamp: string;
                sequence: number;
              };

              if (payload.runId === runId && (!lastSequence || payload.sequence > lastSequence)) {
                messages.push({
                  id: `${runId}-${payload.timestamp}-${payload.sequence}`,
                  runId: payload.runId,
                  nodeId: payload.nodeRef,
                  level: payload.level,
                  message: payload.message,
                  timestamp: payload.timestamp,
                  sequence: payload.sequence,
                });
              }
            } catch (error) {
              // Ignore parse errors
            }
          },
        }).then(() => {
          clearTimeout(timeout);
          resolve();
        }).catch(() => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Sort by sequence
      messages.sort((a, b) => a.sequence - b.sequence);

      return messages;
    } finally {
      await consumer.disconnect().catch(console.error);
    }
  }

  private async queryLoki(record: WorkflowLogStreamRecord, limit: number): Promise<LokiEntry[]> {
    const selector = this.buildSelector(this.normalizeLabels(record.labels));
    const start = this.toNanoseconds(record.firstTimestamp);
    const end = this.toNanoseconds(record.lastTimestamp);

    const params = new URLSearchParams({
      query: selector,
      start,
      end,
      direction: 'forward',
      limit: limit.toString(),
    });

    const response = await fetch(this.resolveUrl(`/loki/api/v1/query_range?${params.toString()}`), {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Loki query failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      data?: { result?: Array<{ values?: [string, string][] }> };
    };

    const entries: LokiEntry[] = [];
    const results = payload.data?.result ?? [];
    for (const result of results) {
      for (const [timestamp, message] of result.values ?? []) {
        entries.push({
          timestamp: this.fromNanoseconds(timestamp),
          message,
        });
      }
    }

    return entries;
  }

  private async queryLokiTimeRange(selector: string, startTime: string, endTime: string, limit: number): Promise<LokiEntry[]> {
    const params = new URLSearchParams({
      query: selector,
      direction: 'forward',
      limit: limit.toString(),
      start: this.toNanoseconds(new Date(startTime)),
      end: this.toNanoseconds(new Date(endTime)),
    });

    const response = await fetch(this.resolveUrl(`/loki/api/v1/query_range?${params.toString()}`), {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Loki query failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      data?: {
        result?: Array<{
          stream?: Record<string, string>;
          values?: [string, string][];
        }>;
      };
    };

    const entries: LokiEntry[] = [];
    const results = payload.data?.result ?? [];
    for (const result of results) {
      const streamLabels = result.stream ?? {};
      for (const [timestamp, message] of result.values ?? []) {
        entries.push({
          timestamp: this.fromNanoseconds(timestamp),
          message,
          level: streamLabels.level,
          nodeId: streamLabels.node,
        });
      }
    }

    // Sort by timestamp ascending
    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return entries;
  }

  private async queryLokiRange(selector: string, limit: number, cursor?: string): Promise<LokiEntry[]> {
    const params = new URLSearchParams({
      query: selector,
      direction: 'backward', // Most recent first
      limit: limit.toString(),
    });

    if (cursor) {
      // End time is the cursor (exclusive)
      params.set('end', this.toNanoseconds(new Date(cursor)));
    }

    const response = await fetch(this.resolveUrl(`/loki/api/v1/query_range?${params.toString()}`), {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `Loki query failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const payload = (await response.json()) as {
      data?: {
        result?: Array<{
          stream?: Record<string, string>;
          values?: [string, string][];
        }>;
      };
    };

    const entries: LokiEntry[] = [];
    const results = payload.data?.result ?? [];
    for (const result of results) {
      const streamLabels = result.stream ?? {};
      for (const [timestamp, message] of result.values ?? []) {
        entries.push({
          timestamp: this.fromNanoseconds(timestamp),
          message,
          level: streamLabels.level,
          nodeId: streamLabels.node,
        });
      }
    }

    // Sort by timestamp ascending (Loki returns descending)
    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return entries;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.tenantId) {
      headers['X-Scope-OrgID'] = this.tenantId;
    }

    if (this.username && this.password) {
      const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    }

    return headers;
  }

  private resolveUrl(path: string): string {
    const base = (this.baseUrl ?? '').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private buildSelector(labels: Record<string, string>): string {
    const parts = Object.entries(labels).map(([key, value]) =>
      `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    );
    return `{${parts.join(',')}}`;
  }

  private normalizeLabels(input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object') {
      return {};
    }

    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string') as Array<[string, string]>;

    return Object.fromEntries(entries);
  }

  private toNanoseconds(date: Date): string {
    return (BigInt(date.getTime()) * 1000000n).toString();
  }

  private fromNanoseconds(value: string): string {
    let parsed: bigint;
    try {
      parsed = BigInt(value);
    } catch {
      parsed = BigInt(Date.now()) * 1000000n;
    }
    const millis = Number(parsed / 1000000n);
    return new Date(millis).toISOString();
  }

  private requireOrganizationId(auth: AuthContext | null): string {
    const organizationId = auth?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
  }
}
