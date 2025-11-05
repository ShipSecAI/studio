import { beforeEach, describe, expect, it, vi } from 'bun:test';

import {
  LokiLogAdapter,
  type LokiPushClient,
  type LokiStreamLine,
} from '../loki-log.adapter';
import type { WorkflowLogEntry } from '../../temporal/types';
import { workflowLogStreams } from '../schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema';

class FakeClient implements LokiPushClient {
  public calls: Array<{ labels: Record<string, string>; lines: LokiStreamLine[] }> = [];

  async push(labels: Record<string, string>, lines: LokiStreamLine[]): Promise<void> {
    this.calls.push({ labels, lines });
  }
}

class FailingClient implements LokiPushClient {
  async push(): Promise<void> {
    throw new Error('boom');
  }
}

class FakeDb {
  public inserted: Array<{ table: unknown; input: unknown }> = [];

  insert(table: unknown) {
    return {
      values: (input: unknown) => {
        this.inserted.push({ table, input });
        return {
          onConflictDoUpdate: async () => {
            // no-op for tests
          },
        };
      },
    };
  }
}

describe('LokiLogAdapter', () => {
  let client: FakeClient;
  let db: FakeDb;
  let adapter: LokiLogAdapter;

  const buildEntry = (overrides: Partial<WorkflowLogEntry> = {}): WorkflowLogEntry => ({
    runId: 'run-123',
    nodeRef: 'node-1',
    stream: 'stdout',
    message: 'hello world',
    level: 'info',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    metadata: {
      activityId: 'activity-1',
      attempt: 2,
      correlationId: 'corr-1',
      streamId: 'stream-1',
      joinStrategy: 'all',
      triggeredBy: 'parent-node',
    },
    ...overrides,
  });

  beforeEach(() => {
    client = new FakeClient();
    db = new FakeDb();
    adapter = new LokiLogAdapter(
      client,
      db as unknown as NodePgDatabase<typeof schema>,
    );
  });

  it('pushes logs to Loki and persists metadata', async () => {
    const entry = buildEntry({ message: 'first line\nsecond line\n' });

    await adapter.append(entry);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.labels).toMatchObject({
      run_id: 'run-123',
      node: 'node-1',
      stream: 'stdout',
      level: 'info',
      activity_id: 'activity-1',
      attempt: '2',
      correlation_id: 'corr-1',
      stream_id: 'stream-1',
      join_strategy: 'all',
      triggered_by: 'parent-node',
    });
    expect(call.lines).toHaveLength(2);
    expect(call.lines[0]).toMatchObject({
      message: 'first line',
    });
    expect(call.lines[1]).toMatchObject({
      message: 'second line',
    });

    expect(db.inserted).toHaveLength(1);
    const persisted = db.inserted[0];
    expect(persisted.table).toBe(workflowLogStreams);
    expect(persisted.input).toMatchObject({
      runId: 'run-123',
      nodeRef: 'node-1',
      stream: 'stdout',
      lineCount: 2,
    });
  });

  it('skips empty messages', async () => {
    await adapter.append(buildEntry({ message: '   \n   ' }));

    expect(client.calls).toHaveLength(0);
    expect(db.inserted).toHaveLength(0);
  });

  it('does not persist metadata when Loki push fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingAdapter = new LokiLogAdapter(
      new FailingClient(),
      db as unknown as NodePgDatabase<typeof schema>,
    );

    await failingAdapter.append(buildEntry());

    expect(db.inserted).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('handles concurrent appends without dropping entries', async () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      buildEntry({
        message: `message-${index}`,
        timestamp: new Date(`2025-01-01T00:00:${index.toString().padStart(2, '0')}Z`),
      }),
    );

    await Promise.all(entries.map((entry) => adapter.append(entry)));

    expect(client.calls).toHaveLength(entries.length);
    const seenMessages = client.calls.map((call) => call.lines[0]?.message);
    entries.forEach((entry) => {
      expect(seenMessages).toContain(entry.message);
    });
  });
});
