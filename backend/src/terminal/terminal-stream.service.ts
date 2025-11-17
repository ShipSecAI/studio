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
}

export interface TerminalFetchResult {
  cursor: string;
  chunks: TerminalChunk[];
}

@Injectable()
export class TerminalStreamService implements OnModuleDestroy {
  constructor(@Inject(TERMINAL_REDIS) private readonly redis: Redis | null) {}

  async onModuleDestroy() {
    await this.redis?.quit();
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

      for (const [id, fields] of entries) {
        const payload = this.extractPayload(key, fields);
        if (payload) {
          chunks.push(payload);
        }
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

  private extractPayload(key: string, fields: string[]): TerminalChunk | null {
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
        return {
          nodeRef,
          stream,
          chunkIndex: data.chunkIndex,
          payload: data.payload,
          recordedAt: data.recordedAt,
          deltaMs: data.deltaMs,
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
