import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { LogStreamService } from '../log-stream.service';
import type { WorkflowLogStreamRecord } from '../../database/schema';
import type { LogStreamRepository } from '../log-stream.repository';
import type { AuthContext } from '../../auth/types';

describe('LogStreamService', () => {
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
  const authContext: AuthContext = {
    userId: 'test-user',
    organizationId: 'test-org',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };
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
    organizationId: 'test-org',
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

    await expect(service.fetch('run-123', null)).rejects.toThrow('Loki integration is not configured');
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
    const result = await service.fetch('run-123', authContext, { nodeRef: 'node-1', stream: 'stdout' });

    expect(result.logs).toHaveLength(2);
    expect(result.logs[0]).toEqual({
      id: `run-123-${record.firstTimestamp.toISOString()}-0`,
      runId: 'run-123',
      nodeId: 'unknown',
      level: 'info',
      message: 'line one',
      timestamp: record.firstTimestamp.toISOString(),
    });
    expect(result.logs[1]).toEqual({
      id: `run-123-${new Date(record.firstTimestamp.getTime() + 500).toISOString()}-1`,
      runId: 'run-123',
      nodeId: 'unknown',
      level: 'info',
      message: 'line two',
      timestamp: new Date(record.firstTimestamp.getTime() + 500).toISOString(),
    });
    expect(calls).toHaveLength(1);
    const calledUrl = decodeURIComponent(calls[0].input.toString());
    expect(calledUrl).toContain('/loki/api/v1/query_range');
    expect(calledUrl).toContain('run_id="run-123"');
  });

  it('derives start and end timestamps from stored metadata', async () => {
    const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
    const first = new Date('2025-02-01T00:00:00Z');
    const last = new Date('2025-02-01T00:05:00Z');
    const firstNs = (BigInt(first.getTime()) * 1000000n).toString();
    const lastNs = (BigInt(last.getTime()) * 1000000n).toString();

    // @ts-expect-error override global fetch for test
    global.fetch = async (input: string | URL) => {
      calls.push({ input });
      return {
        ok: true,
        json: async () => ({
          data: {
            result: [],
          },
        }),
      } as Response;
    };

    const repository = {
      listByRunId: async () => [
        {
          ...record,
          firstTimestamp: first,
          lastTimestamp: last,
        },
      ],
    } as unknown as LogStreamRepository;

    const service = new LogStreamService(repository);
    await service.fetch('run-456', authContext, {});

    expect(calls).toHaveLength(1);
    const calledUrl = calls[0].input.toString();
    expect(calledUrl).toContain(`start=${firstNs}`);
    expect(calledUrl).toContain(`end=${lastNs}`);
  });
});
