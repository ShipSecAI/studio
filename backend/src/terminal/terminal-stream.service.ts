import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';

export const TERMINAL_REDIS = Symbol('TERMINAL_REDIS');

export interface TerminalChunk {
  nodeRef: string;
  stream: string;
  chunkIndex: number;
  payload: string;
  recordedAt: string;
  deltaMs: number;
  origin?: string;
  runnerKind?: string;
}

export interface TerminalFetchOptions {
  cursor?: string;
  nodeRef?: string;
  stream?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface TerminalFetchResult {
  cursor: string;
  chunks: TerminalChunk[];
}

export interface TerminalStreamDescriptor {
  nodeRef: string;
  stream: string;
  key: string;
}

@Injectable()
export class TerminalStreamService implements OnModuleDestroy {
  constructor(@Inject(TERMINAL_REDIS) private readonly redis: Redis | null) {}

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  async listStreams(runId: string): Promise<TerminalStreamDescriptor[]> {
    if (!this.redis) {
      return [];
    }
    const pattern = `terminal:${runId}:*`;
    const keys = await this.scanKeys(pattern);
    const seen = new Map<string, TerminalStreamDescriptor>();
    for (const key of keys) {
      const { nodeRef, stream } = this.parseKey(key);
      const dedupeKey = `${nodeRef}:${stream}`;
      if (!seen.has(dedupeKey)) {
        seen.set(dedupeKey, { nodeRef, stream, key });
      }
    }
    return Array.from(seen.values());
  }

  async deleteStreams(runId: string, options: TerminalFetchOptions = {}): Promise<number> {
    if (!this.redis) {
      return 0;
    }

    const nodePattern = options.nodeRef ? this.sanitizeNode(options.nodeRef) : '*';
    const streamPattern = options.stream ?? '*';
    const pattern = `terminal:${runId}:${nodePattern}:${streamPattern}`;
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) {
      return 0;
    }
    return this.redis!.del(...keys);
  }

  async fetchChunks(runId: string, options: TerminalFetchOptions = {}): Promise<TerminalFetchResult> {
    if (!this.redis) {
      return { cursor: options.cursor ?? '{}', chunks: [] };
    }

    const state = this.parseCursor(options.cursor);
    const nodePattern = options.nodeRef ? this.sanitizeNode(options.nodeRef) : '*';
    const streamPattern = options.stream ?? '*';
    const pattern = `terminal:${runId}:${nodePattern}:${streamPattern}`;

    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) {
      return { cursor: this.serializeCursor(state), chunks: [] };
    }

    const nextState = { ...state };
    const chunks: TerminalChunk[] = [];

    for (const key of keys) {
      const lastId = state[key];
      const start = this.buildStartId(lastId);
      const entries = await this.redis!.xrange(key, start, '+');
      if (entries.length === 0) {
        continue;
      }

      let previousRedisId: string | undefined = undefined;
      for (const [id, fields] of entries) {
        const payload = this.extractPayload(key, fields, id, previousRedisId);
        if (payload) {
          // Filter by time range if provided
          if (options.startTime || options.endTime) {
            const recordedAt = new Date(payload.recordedAt);
            if (options.startTime && recordedAt < options.startTime) {
              previousRedisId = id; // Still track previous ID even if filtered out
              continue; // Skip chunks before startTime
            }
            if (options.endTime && recordedAt > options.endTime) {
              previousRedisId = id; // Still track previous ID even if filtered out
              continue; // Skip chunks after endTime
            }
          }
          chunks.push(payload);
        }
        previousRedisId = id; // Track previous Redis ID for deltaMs calculation
        nextState[key] = id;
      }
    }

    return {
      cursor: this.serializeCursor(nextState),
      chunks,
    };
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    if (!this.redis) {
      return [];
    }

    let cursor = '0';
    const results: string[] = [];
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 50);
      results.push(...keys);
      cursor = next;
    } while (cursor !== '0');
    return results;
  }

  private extractPayload(key: string, fields: string[], redisId?: string, previousRedisId?: string): TerminalChunk | null {
    for (let i = 0; i < fields.length; i += 2) {
      if (fields[i] !== 'data') {
        continue;
      }
      try {
        const data = JSON.parse(fields[i + 1]) as {
          chunkIndex: number;
          payload: string;
          recordedAt: string;
          deltaMs: number;
          origin?: string;
          runnerKind?: string;
        };
        const { nodeRef, stream } = this.parseKey(key);
        
        // Use Redis stream ID timestamp if chunks have identical recordedAt timestamps
        // Redis stream IDs are in format: milliseconds-sequence (e.g., "1734972072337-0")
        // This provides microsecond precision for ordering
        let recordedAt = data.recordedAt;
        let deltaMs = data.deltaMs;
        
        if (redisId) {
          const [redisTimestampMs] = redisId.split('-');
          const redisTimestamp = parseInt(redisTimestampMs, 10);
          const storedTimestamp = new Date(data.recordedAt).getTime();
          
          // If Redis timestamp is more precise (different from stored), use it
          // This handles the case where multiple chunks were created in the same millisecond
          if (redisTimestamp && redisTimestamp !== storedTimestamp) {
            const oldRecordedAt = recordedAt;
            recordedAt = new Date(redisTimestamp).toISOString();
            
            // Recalculate deltaMs based on Redis timestamps if we have previous chunk
            // This fixes the case where stored deltaMs is 0 but chunks were actually created at different times
            if (previousRedisId) {
              const [prevRedisTimestampMs] = previousRedisId.split('-');
              const prevRedisTimestamp = parseInt(prevRedisTimestampMs, 10);
              if (prevRedisTimestamp && redisTimestamp > prevRedisTimestamp) {
                const oldDeltaMs = deltaMs;
                deltaMs = redisTimestamp - prevRedisTimestamp;
                console.log(`[TerminalStreamService] Fixed timestamp and deltaMs for chunk ${data.chunkIndex}`, {
                  oldRecordedAt,
                  newRecordedAt: recordedAt,
                  oldDeltaMs,
                  newDeltaMs: deltaMs,
                  redisTimestamp,
                  prevRedisTimestamp,
                });
              }
            } else {
              console.log(`[TerminalStreamService] Fixed timestamp for chunk ${data.chunkIndex} (first chunk)`, {
                oldRecordedAt,
                newRecordedAt: recordedAt,
                redisTimestamp,
                storedTimestamp,
              });
            }
          }
        }
        
        return {
          nodeRef,
          stream,
          chunkIndex: data.chunkIndex,
          payload: data.payload,
          recordedAt,
          deltaMs,
          origin: data.origin,
          runnerKind: data.runnerKind,
        };
      } catch (error) {
        console.warn('Failed to parse terminal chunk payload', error);
        return null;
      }
    }
    return null;
  }

  private parseKey(key: string): { nodeRef: string; stream: string } {
    const parts = key.split(':');
    const stream = parts.pop() ?? 'stdout';
    const nodeRef = parts.slice(2).join(':') || 'unknown';
    return { nodeRef, stream };
  }

  private sanitizeNode(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_.-]/g, '_');
  }

  private parseCursor(input?: string): Record<string, string> {
    if (!input) {
      return {};
    }
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, string>;
      }
    } catch {}
    return {};
  }

  private serializeCursor(state: Record<string, string>): string {
    return JSON.stringify(state);
  }

  private buildStartId(lastId?: string): string {
    if (!lastId) {
      return '-';
    }
    const [ms, seq] = lastId.split('-');
    const nextSeq = Number(seq ?? '0') + 1;
    return `${ms}-${nextSeq}`;
  }
}
