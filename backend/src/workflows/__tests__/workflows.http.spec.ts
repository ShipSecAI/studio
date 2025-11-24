import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { WorkflowRunStatusSchema, TraceStreamEnvelopeSchema } from '@shipsec/shared';

import { WorkflowsController } from '../workflows.controller';
import { WorkflowLogsQuerySchema } from '../dto/workflow-graph.dto';

const sampleStatus = WorkflowRunStatusSchema.parse({
  runId: 'shipsec-run-123',
  workflowId: 'workflow-id-123',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  taskQueue: 'shipsec-default',
  historyLength: 42,
});

const sampleTrace = TraceStreamEnvelopeSchema.parse({
  runId: 'shipsec-run-123',
  events: [
    {
      id: '1',
      runId: 'shipsec-run-123',
      nodeId: 'node-1',
      type: 'STARTED',
      level: 'info',
      timestamp: new Date().toISOString(),
    },
  ],
  cursor: '1',
});

const sampleLogs = {
  runId: 'shipsec-run-123',
  streams: [
    {
      nodeRef: 'node-1',
      stream: 'stdout',
      labels: { run_id: 'shipsec-run-123', node: 'node-1', stream: 'stdout' },
      firstTimestamp: new Date().toISOString(),
      lastTimestamp: new Date().toISOString(),
      lineCount: 2,
      entries: [
        {
          timestamp: new Date().toISOString(),
          message: 'line one',
        },
      ],
    },
  ],
};

const authContext = {
  userId: 'user-123',
  organizationId: 'org-123',
  roles: ['ADMIN'] as const,
  isAuthenticated: true,
  provider: 'local',
};

describe('WorkflowsController contract coverage', () => {
  let controller: WorkflowsController;
  const workflowService = {
    getRunStatus: vi.fn().mockResolvedValue(sampleStatus),
    getRunResult: vi.fn(),
    cancelRun: vi.fn(),
  } as const;

  const traceService = {
    list: vi.fn().mockResolvedValue(sampleTrace),
  } as const;

  const logStreamService = {
    fetch: vi.fn().mockResolvedValue(sampleLogs),
  } as const;
  const artifactsService = {
    listRunArtifacts: vi.fn().mockResolvedValue({ runId: sampleStatus.runId, artifacts: [] }),
  } as const;
  const terminalStreamService = {
    fetchChunks: vi.fn().mockResolvedValue({ cursor: '{}', chunks: [] }),
  } as const;
  const terminalArchiveService = {
    archive: vi.fn(),
    list: vi.fn(),
    download: vi.fn(),
  } as const;

  beforeEach(() => {
    controller = new WorkflowsController(
      workflowService as any,
      traceService as any,
      logStreamService as any,
      artifactsService as any,
      terminalStreamService as any,
      terminalArchiveService as any,
    );
    vi.clearAllMocks();
  });

  it('returns status payload matching the shared contract', async () => {
    const result = await controller.status('shipsec-run-123', { temporalRunId: undefined }, authContext as any);
    const parsed = WorkflowRunStatusSchema.parse(result);
    expect(parsed.runId).toBe(sampleStatus.runId);
    expect(parsed.workflowId).toBe(sampleStatus.workflowId);
    expect(workflowService.getRunStatus).toHaveBeenCalledWith(
      'shipsec-run-123',
      undefined,
      authContext,
    );
  });

  it('returns trace payload matching the shared contract', async () => {
    const result = await controller.trace('shipsec-run-123', authContext as any);
    const parsed = TraceStreamEnvelopeSchema.parse(result);
    expect(parsed.events).toHaveLength(1);
    expect(traceService.list).toHaveBeenCalledWith('shipsec-run-123', authContext);
  });

  it('retrieves logs with validated query parameters', async () => {
    const query = WorkflowLogsQuerySchema.parse({ nodeRef: 'node-1', stream: 'stdout', limit: 10 });
    const result = await controller.logs('shipsec-run-123', query, authContext as any);
    expect(result).toEqual(sampleLogs);
    expect(logStreamService.fetch).toHaveBeenCalledWith('shipsec-run-123', authContext, {
      nodeRef: 'node-1',
      stream: 'stdout',
      limit: 10,
    });
  });
});
