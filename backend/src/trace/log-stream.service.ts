import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { LogStreamRepository } from './log-stream.repository';
import type { WorkflowLogStreamRecord } from '../database/schema';

interface FetchLogsOptions {
  nodeRef?: string;
  stream?: string;
  limit?: number;
}

interface LokiEntry {
  timestamp: string;
  message: string;
}

@Injectable()
export class LogStreamService {
  private readonly baseUrl?: string;
  private readonly tenantId?: string;
  private readonly username?: string;
  private readonly password?: string;

  constructor(private readonly repository: LogStreamRepository) {
    this.baseUrl = process.env.LOKI_URL;
    this.tenantId = process.env.LOKI_TENANT_ID;
    this.username = process.env.LOKI_USERNAME;
    this.password = process.env.LOKI_PASSWORD;
  }

  async fetch(runId: string, options: FetchLogsOptions = {}) {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException('Loki integration is not configured');
    }

    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 2000) : 500;
    const streamFilter =
      options.stream && ['stdout', 'stderr', 'console'].includes(options.stream)
        ? (options.stream as 'stdout' | 'stderr' | 'console')
        : undefined;
    const streams = await this.repository.listByRunId(runId, options.nodeRef, streamFilter);

    const payload = [] as Array<{
      nodeRef: string;
      stream: string;
      labels: Record<string, string>;
      firstTimestamp: string;
      lastTimestamp: string;
      lineCount: number;
      entries: LokiEntry[];
    }>;

    for (const record of streams) {
      const entries = await this.queryLoki(record, limit);
      payload.push({
        nodeRef: record.nodeRef,
        stream: record.stream,
        labels: this.normalizeLabels(record.labels),
        firstTimestamp: record.firstTimestamp.toISOString(),
        lastTimestamp: record.lastTimestamp.toISOString(),
        lineCount: record.lineCount,
        entries,
      });
    }

    return { runId, streams: payload };
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
}
