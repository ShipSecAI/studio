import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { LogStreamService } from '../log-stream.service';
import type { WorkflowLogStreamRecord } from '../../database/schema';
import type { LogStreamRepository } from '../log-stream.repository';

describe('LogStreamService', () => {
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
  const record: WorkflowLogStreamRecord = {
    id: 1,
    runId: 'run-123',
    nodeRef: 'node-1',
    stream: 'stdout',
    labels: { run_id: 'run-123', node: 'node-1', stream: 'stdout' },
    firstTimestamp: new Date('2025-01-01T00:00:00Z'),
    lastTimestamp: new Date('2025-01-01T00:00:01Z'),
    lineCount: 2,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:01Z'),
  };

  beforeEach(() => {
    process.env.LOKI_URL = 'http://loki.example.com';
    process.env.LOKI_USERNAME = '';
    process.env.LOKI_PASSWORD = '';
    process.env.LOKI_TENANT_ID = '';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('throws when Loki is not configured', async () => {
    delete process.env.LOKI_URL;
    const repository = {
      listByRunId: async () => [record],
    } as unknown as LogStreamRepository;
    const service = new LogStreamService(repository);

    await expect(service.fetch('run-123')).rejects.toThrow('Loki integration is not configured');
  });

  it('returns log entries from Loki', async () => {
    const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
    const nanoTs = (BigInt(record.firstTimestamp.getTime()) * 1000000n).toString();

    // @ts-expect-error override global fetch for test
    global.fetch = async (input: string | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return {
        ok: true,
        json: async () => ({
          data: {
            result: [
              {
                values: [
                  [nanoTs, 'line one'],
                  [(BigInt(nanoTs) + 500000000n).toString(), 'line two'],
                ],
              },
            ],
          },
        }),
      } as Response;
    };

    const repository = {
      listByRunId: async () => [record],
    } as unknown as LogStreamRepository;
    const service = new LogStreamService(repository);
    const result = await service.fetch('run-123', { nodeRef: 'node-1', stream: 'stdout' });

    expect(result.streams).toHaveLength(1);
    const [stream] = result.streams;
    expect(stream.entries).toEqual([
      {
        timestamp: record.firstTimestamp.toISOString(),
        message: 'line one',
      },
      {
        timestamp: new Date(record.firstTimestamp.getTime() + 500).toISOString(),
        message: 'line two',
      },
    ]);
    expect(calls).toHaveLength(1);
    const calledUrl = decodeURIComponent(calls[0].input.toString());
    expect(calledUrl).toContain('/loki/api/v1/query_range');
    expect(calledUrl).toContain('run_id="run-123"');
  });
});
