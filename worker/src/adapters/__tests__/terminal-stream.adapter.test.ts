import { describe, it, expect, vi } from 'bun:test';
import type Redis from 'ioredis';
import { RedisTerminalStreamAdapter } from '../terminal-stream.adapter';

function createRedisMock() {
  return {
    xadd: vi.fn().mockResolvedValue('1-0'),
  } as unknown as Redis;
}

describe('RedisTerminalStreamAdapter', () => {
  it('writes chunk payloads to redis stream', async () => {
    const redis = createRedisMock();
    const adapter = new RedisTerminalStreamAdapter(redis, { maxEntries: 10 });

    await adapter.append({
      runId: 'run-123',
      nodeRef: 'node.alpha',
      stream: 'stdout',
      chunkIndex: 5,
      payload: Buffer.from('hello').toString('base64'),
      recordedAt: new Date().toISOString(),
      deltaMs: 0,
      origin: 'docker',
      runnerKind: 'docker',
    });

    expect(redis.xadd).toHaveBeenCalledTimes(1);
    const [key, , , maxLen, , field, value] = (redis.xadd as any).mock.calls[0];
    expect(key).toBe('terminal:run-123:node.alpha:stdout');
    expect(maxLen).toBe(10);
    expect(field).toBe('data');
    const parsed = JSON.parse(value);
    expect(parsed.chunkIndex).toBe(5);
  });

  it('sanitizes node references in keys', async () => {
    const redis = createRedisMock();
    const adapter = new RedisTerminalStreamAdapter(redis);
    await adapter.append({
      runId: 'run-1',
      nodeRef: 'node$1',
      stream: 'stderr',
      chunkIndex: 1,
      payload: '',
      recordedAt: new Date().toISOString(),
      deltaMs: 0,
      origin: 'docker',
      runnerKind: 'docker',
    });
    const [key] = (redis.xadd as any).mock.calls[0];
    expect(key).toBe('terminal:run-1:node_1:stderr');
  });
});
