import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { LogIngestService } from '../log-ingest.service';
import type { LogStreamRepository } from '../../trace/log-stream.repository';

describe('LogIngestService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LOG_KAFKA_BROKERS = 'localhost:9092';
    process.env.LOKI_URL = 'http://localhost:3100';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts sensitive data before pushing to Loki', async () => {
    const repository = {
      upsertMetadata: mock(async () => undefined),
    } as unknown as LogStreamRepository;

    const service = new LogIngestService(repository);
    const push = mock(async () => undefined);
    (service as any).lokiClient = { push };

    await (service as any).processEntry({
      runId: 'run-1',
      nodeRef: 'node-1',
      stream: 'stdout',
      message: 'token=abc123 authorization=Bearer super-secret',
      timestamp: '2026-02-21T00:00:00.000Z',
      organizationId: 'org-1',
    });

    expect(push).toHaveBeenCalledTimes(1);
    const call = push.mock.calls[0] as unknown[] | undefined;
    expect(call).toBeTruthy();
    const lines = (call?.[1] ?? []) as { message: string }[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toContain('token=[REDACTED]');
    expect(lines[0]?.message).toContain('authorization=[REDACTED]');
    expect(lines[0]?.message).not.toContain('abc123');
    expect(lines[0]?.message).not.toContain('super-secret');
  });
});
