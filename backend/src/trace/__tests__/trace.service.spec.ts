import { describe, expect, it } from 'bun:test';

import type { WorkflowTraceRecord } from '../../database/schema';
import { TraceService } from '../trace.service';

class FakeTraceRepository {
  public events: WorkflowTraceRecord[] = [];

  async listByRunId(runId: string): Promise<WorkflowTraceRecord[]> {
    return this.events
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listAfterSequence(runId: string, sequence: number): Promise<WorkflowTraceRecord[]> {
    return this.events
      .filter((event) => event.runId === runId && event.sequence > sequence)
      .sort((a, b) => a.sequence - b.sequence);
  }
}

describe('TraceService', () => {
  const repository = new FakeTraceRepository();
  const service = new TraceService(repository as any);
  const runId = 'service-run';

  it('maps stored records to trace events', async () => {
    repository.events = [
      {
        id: 1,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_STARTED',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:00.000Z'),
        message: null,
        error: null,
        outputSummary: null,
        level: 'info',
        data: null,
        sequence: 1,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      {
        id: 2,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_PROGRESS',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:01.000Z'),
        message: 'Working',
        error: null,
        outputSummary: null,
        level: 'info',
        data: null,
        sequence: 2,
        createdAt: new Date('2025-01-01T00:00:01.000Z'),
      },
      {
        id: 3,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_COMPLETED',
        nodeRef: 'node-1',
        timestamp: new Date('2025-01-01T00:00:02.000Z'),
        message: null,
        error: null,
        outputSummary: { ok: true },
        level: 'info',
        data: null,
        sequence: 3,
        createdAt: new Date('2025-01-01T00:00:02.000Z'),
      },
      {
        id: 4,
        runId,
        workflowId: 'workflow-id',
        type: 'NODE_FAILED',
        nodeRef: 'node-2',
        timestamp: new Date('2025-01-01T00:00:03.000Z'),
        message: null,
        error: 'Oops',
        outputSummary: null,
        level: 'error',
        data: null,
        sequence: 4,
        createdAt: new Date('2025-01-01T00:00:03.000Z'),
      },
    ];

    const { events, cursor } = await service.list(runId);
    expect(events).toEqual([
      {
        id: '1',
        type: 'STARTED',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:00.000Z',
        message: undefined,
        error: undefined,
        outputSummary: undefined,
        data: undefined,
      },
      {
        id: '2',
        type: 'PROGRESS',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:01.000Z',
        message: 'Working',
        error: undefined,
        outputSummary: undefined,
        data: undefined,
      },
      {
        id: '3',
        type: 'COMPLETED',
        level: 'info',
        runId,
        nodeId: 'node-1',
        timestamp: '2025-01-01T00:00:02.000Z',
        message: undefined,
        error: undefined,
        outputSummary: { ok: true },
        data: undefined,
      },
      {
        id: '4',
        type: 'FAILED',
        level: 'error',
        runId,
        nodeId: 'node-2',
        timestamp: '2025-01-01T00:00:03.000Z',
        message: undefined,
        error: { message: 'Oops' },
        outputSummary: undefined,
        data: undefined,
      },
    ]);
    expect(cursor).toBe('4');
  });

  it('lists events after a sequence cursor', async () => {
    const { events } = await service.listSince(runId, 2);
    expect(events.map((event) => event.id)).toEqual(['3', '4']);
  });
});
