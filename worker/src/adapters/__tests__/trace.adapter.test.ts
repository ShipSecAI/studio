import { describe, it, expect, beforeEach } from 'bun:test';
import { TraceAdapter } from '../trace.adapter';
import type { TraceEvent } from '@shipsec/component-sdk';
import { workflowTraces } from '../schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';

describe('TraceAdapter', () => {
  let adapter: TraceAdapter;
  const noopLogger = {
    log: () => {},
    error: () => {},
  };

  class FakeDb {
    public inserts: Array<{ table: unknown; input: unknown }> = [];

    insert(table: unknown) {
      return {
        values: async (input: unknown) => {
          this.inserts.push({ table, input });
        },
      };
    }
  }

  beforeEach(() => {
    adapter = new TraceAdapter(undefined, { buffer: true, logger: noopLogger });
  });

  describe('record', () => {
    it('should record a trace event', () => {
      const event: TraceEvent = {
        type: 'NODE_STARTED',
        runId: 'test-run-123',
        nodeRef: 'node-1',
        timestamp: new Date().toISOString(),
        level: 'info',
      };

      adapter.record(event);

      const events = adapter.getEvents('test-run-123');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should record multiple events', () => {
      const events: TraceEvent[] = [
        {
          type: 'NODE_STARTED',
          runId: 'run-456',
          nodeRef: 'node-1',
          timestamp: new Date().toISOString(),
          level: 'info',
        },
        {
          type: 'NODE_PROGRESS',
          runId: 'run-456',
          nodeRef: 'node-1',
          timestamp: new Date().toISOString(),
          message: 'Processing...',
          level: 'info',
        },
        {
          type: 'NODE_COMPLETED',
          runId: 'run-456',
          nodeRef: 'node-1',
          timestamp: new Date().toISOString(),
          outputSummary: { result: 'success' },
          level: 'info',
        },
      ];

      events.forEach((event) => adapter.record(event));

      const recorded = adapter.getEvents('run-456');
      expect(recorded).toHaveLength(3);
      expect(recorded[0].type).toBe('NODE_STARTED');
      expect(recorded[1].type).toBe('NODE_PROGRESS');
      expect(recorded[2].type).toBe('NODE_COMPLETED');
    });

    it('should record events with optional fields', () => {
      const progressEvent: TraceEvent = {
        type: 'NODE_PROGRESS',
        runId: 'run-789',
        nodeRef: 'node-2',
        timestamp: new Date().toISOString(),
        message: 'Step 1 complete',
        level: 'info',
      };

      const failedEvent: TraceEvent = {
        type: 'NODE_FAILED',
        runId: 'run-789',
        nodeRef: 'node-3',
        timestamp: new Date().toISOString(),
        error: 'Timeout error',
        level: 'error',
      };

      adapter.record(progressEvent);
      adapter.record(failedEvent);

      const events = adapter.getEvents('run-789');
      expect(events[0].message).toBe('Step 1 complete');
      expect(events[1].error).toBe('Timeout error');
    });

    it('should handle concurrent event recording without loss', async () => {
      const runId = 'concurrent-run';
      const total = 50;
      const timestamps = Array.from({ length: total }, (_, index) =>
        new Date(Date.now() + index).toISOString(),
      );

      await Promise.all(
        timestamps.map(
          (timestamp, index) =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                adapter.record({
                  type: index % 2 === 0 ? 'NODE_PROGRESS' : 'NODE_COMPLETED',
                  runId,
                  nodeRef: `node-${index % 5}`,
                  timestamp,
                  level: 'info',
                  message: `event-${index}`,
                });
                resolve();
              }, Math.floor(Math.random() * 5));
            }),
        ),
      );

      const recorded = adapter.getEvents(runId);
      expect(recorded).toHaveLength(total);
      const messages = recorded.map((event) => event.message);
      timestamps.forEach((_, index) => {
        expect(messages).toContain(`event-${index}`);
      });
    });
  });

  describe('getEvents', () => {
    it('should return events for specific run', () => {
      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-1',
        nodeRef: 'node-a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-2',
        nodeRef: 'node-b',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-1',
        nodeRef: 'node-a',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      const run1Events = adapter.getEvents('run-1');
      const run2Events = adapter.getEvents('run-2');

      expect(run1Events).toHaveLength(2);
      expect(run2Events).toHaveLength(1);
      expect(run1Events.every((e) => e.runId === 'run-1')).toBe(true);
      expect(run2Events.every((e) => e.runId === 'run-2')).toBe(true);
    });

    it('should return empty array for unknown run', () => {
      const events = adapter.getEvents('non-existent-run');
      expect(events).toHaveLength(0);
    });

    it('should maintain event order', () => {
      const timestamps = [
        new Date('2025-01-01T10:00:00Z').toISOString(),
        new Date('2025-01-01T10:01:00Z').toISOString(),
        new Date('2025-01-01T10:02:00Z').toISOString(),
      ];

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-order',
        nodeRef: 'node-1',
        timestamp: timestamps[0],
        level: 'info',
      });

      adapter.record({
        type: 'NODE_PROGRESS',
        runId: 'run-order',
        nodeRef: 'node-1',
        timestamp: timestamps[1],
        level: 'info',
      });

      adapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-order',
        nodeRef: 'node-1',
        timestamp: timestamps[2],
        level: 'info',
      });

      const events = adapter.getEvents('run-order');
      expect(events.map((e) => e.timestamp)).toEqual(timestamps);
    });

    it('should return empty array when buffering is disabled', () => {
      const nonBuffered = new TraceAdapter(undefined, { buffer: false, logger: noopLogger });
      nonBuffered.record({
        type: 'NODE_STARTED',
        runId: 'run-no-buffer',
        nodeRef: 'node-1',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      expect(nonBuffered.getEvents('run-no-buffer')).toHaveLength(0);
      nonBuffered.clear();
      nonBuffered.finalizeRun('run-no-buffer');
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-clear-1',
        nodeRef: 'node-1',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-clear-2',
        nodeRef: 'node-2',
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      expect(adapter.getEvents('run-clear-1')).toHaveLength(1);
      expect(adapter.getEvents('run-clear-2')).toHaveLength(1);

      adapter.clear();

      expect(adapter.getEvents('run-clear-1')).toHaveLength(0);
      expect(adapter.getEvents('run-clear-2')).toHaveLength(0);
    });
  });

  describe('finalizeRun', () => {
    it('should release resources for specific run', () => {
      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-finalize',
        nodeRef: 'node-1',
        timestamp: new Date().toISOString(),
        level: 'info',
      });
      adapter.setRunMetadata('run-finalize', { workflowId: 'wf' });

      adapter.finalizeRun('run-finalize');

      expect(adapter.getEvents('run-finalize')).toHaveLength(0);
      adapter.record({
        type: 'NODE_STARTED',
        runId: 'run-finalize',
        nodeRef: 'node-2',
        timestamp: new Date().toISOString(),
        level: 'info',
      });
      expect(adapter.getEvents('run-finalize')).toHaveLength(1);
    });
  });

  describe('ITraceService interface compliance', () => {
    it('should implement all required methods', () => {
      expect(typeof adapter.record).toBe('function');
    });

    it('should accept events matching TraceEvent type', () => {
      const nodeStarted: TraceEvent = {
        type: 'NODE_STARTED',
        runId: 'test',
        nodeRef: 'ref',
        timestamp: new Date().toISOString(),
        level: 'info',
      };

      const nodeCompleted: TraceEvent = {
        type: 'NODE_COMPLETED',
        runId: 'test',
        nodeRef: 'ref',
        timestamp: new Date().toISOString(),
        outputSummary: { data: 'value' },
        level: 'info',
      };

      const nodeFailed: TraceEvent = {
        type: 'NODE_FAILED',
        runId: 'test',
        nodeRef: 'ref',
        timestamp: new Date().toISOString(),
        error: 'Error message',
        level: 'error',
      };

      const nodeProgress: TraceEvent = {
        type: 'NODE_PROGRESS',
        runId: 'test',
        nodeRef: 'ref',
        timestamp: new Date().toISOString(),
        message: 'Progress message',
        level: 'info',
      };

      // Should not throw
      expect(() => adapter.record(nodeStarted)).not.toThrow();
      expect(() => adapter.record(nodeCompleted)).not.toThrow();
      expect(() => adapter.record(nodeFailed)).not.toThrow();
      expect(() => adapter.record(nodeProgress)).not.toThrow();
    });
  });

  describe('persistence', () => {
    it('persists events when database is provided', async () => {
      const fakeDb = new FakeDb();
      const persistentAdapter = new TraceAdapter(
        fakeDb as unknown as NodePgDatabase<typeof schema>,
        { logger: noopLogger },
      );
      const timestamp = new Date('2025-01-01T00:00:00Z').toISOString();

      persistentAdapter.setRunMetadata('run-persist', { workflowId: 'workflow-123' });
      persistentAdapter.record({
        type: 'NODE_PROGRESS',
        runId: 'run-persist',
        nodeRef: 'node-p',
        timestamp,
        message: 'Persist me',
        level: 'warn',
        data: { attempt: 2 },
      });

      // Flush async persistence
      await Promise.resolve();

      expect(fakeDb.inserts).toHaveLength(1);
      expect(fakeDb.inserts[0].table).toBe(workflowTraces);
      expect(fakeDb.inserts[0].input).toMatchObject({
        runId: 'run-persist',
        workflowId: 'workflow-123',
        type: 'NODE_PROGRESS',
        nodeRef: 'node-p',
        sequence: 1,
        level: 'warn',
        message: 'Persist me',
        data: { _payload: { attempt: 2 } },
      });
    });

    it('packs metadata into persistence payload when context is provided', async () => {
      const fakeDb = new FakeDb();
      const persistentAdapter = new TraceAdapter(
        fakeDb as unknown as NodePgDatabase<typeof schema>,
        { logger: noopLogger },
      );
      const timestamp = new Date('2025-01-02T00:00:00Z').toISOString();

      persistentAdapter.record({
        type: 'NODE_COMPLETED',
        runId: 'run-meta',
        nodeRef: 'node-meta',
        timestamp,
        level: 'info',
        context: {
          activityId: 'activity-1',
          attempt: 3,
          correlationId: 'corr',
        },
      });

      await Promise.resolve();

      expect(fakeDb.inserts).toHaveLength(1);
      expect(fakeDb.inserts[0].input).toMatchObject({
        runId: 'run-meta',
        nodeRef: 'node-meta',
        data: {
          _metadata: {
            activityId: 'activity-1',
            attempt: 3,
            correlationId: 'corr',
          },
        },
      });
    });
  });
});
