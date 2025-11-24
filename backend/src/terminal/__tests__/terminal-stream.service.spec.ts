import { describe, it, expect } from 'bun:test';
import type Redis from 'ioredis';
import { TerminalStreamService, TERMINAL_REDIS } from '../terminal-stream.service';

class MockRedis {
  constructor(private readonly entries: Record<string, Array<[string, string]>>) {}
  private scanCalled = false;

  async scan(cursor: string, _matchLabel: string, pattern: string) {
    if (cursor !== '0' || this.scanCalled) {
      return ['0', []];
    }
    this.scanCalled = true;
    const keys = Object.keys(this.entries).filter((key) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(key);
    });
    return ['0', keys];
  }

  async xrange(key: string, start: string) {
    const all = this.entries[key] ?? [];
    return all
      .filter(([id]) => start === '-' || this.compare(id, start) >= 0)
      .map(([id, payload]) => [id, ['data', payload]]);
  }

  private compare(a: string, b: string) {
    const [ams, aseq] = a.split('-').map(Number);
    const [bms, bseq] = b.split('-').map(Number);
    if (ams !== bms) return ams - bms;
    return aseq - bseq;
  }

  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      if (this.entries[key]) {
        delete this.entries[key];
        removed += 1;
      }
    }
    return removed;
  }

  async quit() {}
}

describe('TerminalStreamService', () => {
  it('returns chunks and encodes cursor', async () => {
    const payload = JSON.stringify({ chunkIndex: 1, payload: 'a', recordedAt: '2025-01-01T00:00:00Z', deltaMs: 0 });
    const redis = new MockRedis({ 'terminal:run-1:node.a:stdout': [['1-0', payload]] }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const result = await service.fetchChunks('run-1');

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].nodeRef).toBe('node.a');
    expect(result.cursor.includes('terminal:run-1:node.a:stdout')).toBe(true);
  });

  it('handles missing redis gracefully', async () => {
    const service = new TerminalStreamService(null);
    const result = await service.fetchChunks('run-2', { cursor: '{"foo":"1-0"}' });
    expect(result.chunks).toHaveLength(0);
    expect(result.cursor).toBe('{"foo":"1-0"}');
  });

  it('lists available streams', async () => {
    const redis = new MockRedis({
      'terminal:run-3:node.one:pty': [],
      'terminal:run-3:node.two:stderr': [],
    }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const streams = await service.listStreams('run-3');

    expect(streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeRef: 'node.one', stream: 'pty' }),
        expect.objectContaining({ nodeRef: 'node.two', stream: 'stderr' }),
      ]),
    );
  });

  it('deletes streams by run', async () => {
    const redis = new MockRedis({
      'terminal:run-4:node.one:pty': [],
      'terminal:run-4:node.two:stderr': [],
    }) as unknown as Redis;
    const service = new TerminalStreamService(redis);

    const removed = await service.deleteStreams('run-4');

    expect(removed).toBe(2);
  });
});
