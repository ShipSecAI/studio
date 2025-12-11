import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';

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
  private readonly defaultTailWindowMs = 60_000;

  constructor(private readonly repository: LogStreamRepository) {
    this.baseUrl = process.env.LOKI_URL;
    this.tenantId = process.env.LOKI_TENANT_ID;
    this.username = process.env.LOKI_USERNAME;
    this.password = process.env.LOKI_PASSWORD;
  }

  async fetch(runId: string, auth: AuthContext | null, options: FetchLogsOptions = {}) {
    if (!this.baseUrl) {
      console.warn(`[LogStreamService] Loki not configured (LOKI_URL not set) for runId: ${runId}`);
      throw new ServiceUnavailableException('Loki integration is not configured');
    }

    const organizationId = this.requireOrganizationId(auth);
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 2000) : 500;
    const streams = await this.repository.listByRunId(
      runId,
      organizationId,
      options.nodeRef,
      options.stream as 'stdout' | 'stderr' | 'console' | undefined,
    );

    let startTime = options.startTime;
    let endTime = options.endTime;

    if ((!startTime || !endTime) && streams.length > 0) {
      const earliest = streams.reduce<Date | null>((acc, stream) => {
        if (!acc || stream.firstTimestamp < acc) {
          return stream.firstTimestamp;
        }
        return acc;
      }, null);

      const latest = streams.reduce<Date | null>((acc, stream) => {
        if (!acc || stream.lastTimestamp > acc) {
          return stream.lastTimestamp;
        }
        return acc;
      }, null);

      if (!startTime && earliest) {
        startTime = earliest.toISOString();
      }
      if (!endTime && latest) {
        endTime = latest.toISOString();
      }
    }

    // Build Loki query selector
    const selectorLabels: Record<string, string> = { run_id: runId };
    if (options.nodeRef) selectorLabels.node = options.nodeRef;
    if (options.stream) selectorLabels.stream = options.stream;
    if (options.level) selectorLabels.level = options.level;

    const selector = this.buildSelector(selectorLabels);
    console.log(`[LogStreamService] Fetching logs for runId: ${runId}, selector: ${selector}, limit: ${limit}`);

    // Query Loki - use time range if provided (for timeline scrubbing), otherwise use pagination
    const entries =
      startTime && endTime
        ? await this.queryLokiTimeRange(selector, startTime, endTime, limit)
        : await this.queryLokiRange(selector, limit, options.cursor);

    console.log(`[LogStreamService] Found ${entries.length} log entries for runId: ${runId}`);

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

  async fetchRecentLogs(
    runId: string,
    organizationId?: string | null,
    lastCursor?: string | null,
  ): Promise<{
    logs: Array<{
      id: string;
      runId: string;
      nodeId: string;
      level: string;
      message: string;
      timestamp: string;
      sequence: number;
    }>;
    cursor: string | null;
  }> {
    const selector = this.buildSelector({ run_id: runId });
    const startTime =
      lastCursor ??
      (await this.resolveEarliestTimestamp(runId, organizationId))?.toISOString() ??
      new Date(Date.now() - this.defaultTailWindowMs).toISOString();
    const endTime = new Date().toISOString();

    const entries = await this.queryLokiTimeRange(selector, startTime, endTime, 500);
    const filtered = entries.filter((entry) => {
      if (!lastCursor) {
        return true;
      }
      const ts = Date.parse(entry.timestamp);
      const lastTs = Date.parse(lastCursor);
      if (Number.isNaN(ts) || Number.isNaN(lastTs)) {
        return true;
      }
      return ts > lastTs;
    });

    if (filtered.length === 0) {
      return { logs: [], cursor: lastCursor ?? startTime ?? null };
    }

    const logs = filtered.map((entry, index) => {
      const timestampValue = Date.parse(entry.timestamp);
      const sequence =
        Number.isNaN(timestampValue) || timestampValue < 0
          ? (Date.now() + index)
          : timestampValue;
      return {
        id: `${runId}-${sequence}-${index}`,
        runId,
        nodeId: entry.nodeId || 'unknown',
        level: entry.level || 'info',
        message: entry.message,
        timestamp: entry.timestamp,
        sequence,
      };
    });

    const nextCursor = logs[logs.length - 1]?.timestamp ?? lastCursor ?? startTime ?? null;
    return {
      logs,
      cursor: nextCursor,
    };
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

    const url = this.resolveUrl(`/loki/api/v1/query_range?${params.toString()}`);
    console.log(`[LogStreamService] Querying Loki: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LogStreamService] Loki query failed: ${response.status} ${response.statusText} - ${errorText}`);
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

    console.log(`[LogStreamService] Loki response: ${JSON.stringify({ 
      resultCount: payload.data?.result?.length ?? 0,
      totalValues: payload.data?.result?.reduce((sum, r) => sum + (r.values?.length ?? 0), 0) ?? 0
    })}`);

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

  private async resolveEarliestTimestamp(
    runId: string,
    organizationId?: string | null,
  ): Promise<Date | null> {
    const streams = await this.repository.listByRunId(runId, organizationId ?? null);
    if (!streams.length) {
      return null;
    }
    return streams.reduce<Date | null>((earliest, stream) => {
      if (!earliest || stream.firstTimestamp < earliest) {
        return stream.firstTimestamp;
      }
      return earliest;
    }, null);
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
