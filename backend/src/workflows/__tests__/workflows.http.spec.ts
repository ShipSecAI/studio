import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, beforeAll, afterAll, expect, vi } from 'bun:test';
import {
  WorkflowRunStatusSchema,
  TraceStreamEnvelopeSchema,
} from '@shipsec/shared';

import { WorkflowsController } from '../workflows.controller';
import { WorkflowsService } from '../workflows.service';
import { TraceService } from '../../trace/trace.service';

const sampleStatus = WorkflowRunStatusSchema.parse({
  runId: 'shipsec-run-123',
  workflowId: 'workflow-id-123',
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  taskQueue: 'shipsec-default',
  historyLength: 0,
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

describe('WorkflowsController HTTP', () => {
  let app: INestApplication;
  const workflowService = {
    run: vi.fn(),
    status: vi.fn(),
    commit: vi.fn(),
    getRunStatus: vi.fn().mockResolvedValue(sampleStatus),
    getRunResult: vi.fn(),
    cancelRun: vi.fn(),
  } as unknown as WorkflowsService;

  const traceService = {
    list: vi.fn().mockResolvedValue(sampleTrace),
  } as unknown as TraceService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowsService, useValue: workflowService },
        { provide: TraceService, useValue: traceService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status payload matching the shared contract', async () => {
    await request(app.getHttpServer())
      .get('/workflows/runs/shipsec-run-123/status')
      .expect(200)
      .expect(({ body }) => {
        const parsed = WorkflowRunStatusSchema.parse(body);
        expect(parsed.runId).toBe(sampleStatus.runId);
        expect(parsed.workflowId).toBe(sampleStatus.workflowId);
      });

    expect(workflowService.getRunStatus).toHaveBeenCalledWith('shipsec-run-123', undefined);
  });

  it('returns trace payload matching the shared contract', async () => {
    await request(app.getHttpServer())
      .get('/workflows/runs/shipsec-run-123/trace')
      .expect(200)
      .expect(({ body }) => {
        const parsed = TraceStreamEnvelopeSchema.parse(body);
        expect(parsed.events).toHaveLength(1);
      });

    expect(traceService.list).toHaveBeenCalledWith('shipsec-run-123');
  });
});
