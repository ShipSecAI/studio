import { beforeEach, describe, expect, it } from 'bun:test';

import '@shipsec/worker/components'; // Register components
import type {
  TemporalService,
  WorkflowRunStatus,
} from '../../temporal/temporal.service';
import { TraceService } from '../../trace/trace.service';
import {
  WorkflowGraphDto,
  WorkflowGraphSchema,
} from '../dto/workflow-graph.dto';
import { WorkflowRecord, WorkflowRepository } from '../repository/workflow.repository';
import { WorkflowsService } from '../workflows.service';
import { WorkflowsController } from '../workflows.controller';

const baseGraph: WorkflowGraphDto = WorkflowGraphSchema.parse({
  name: 'Controller workflow',
  description: 'controller test',
  nodes: [
    {
      id: 'trigger',
      type: 'core.trigger.manual',
      label: 'Trigger',
      position: { x: 0, y: 0 },
    },
    {
      id: 'loader',
      type: 'core.file.loader',
      label: 'Loader',
      position: { x: 0, y: 100 },
      config: { fileName: 'controller.txt' },
    },
  ],
  edges: [{ id: 'edge', source: 'trigger', target: 'loader' }],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('WorkflowsController', () => {
  let controller: WorkflowsController;
  let repositoryStore: Map<string, WorkflowRecord>;
  let lastCancelledRun: { workflowId: string; runId?: string } | null = null;
  const now = new Date().toISOString();

  const repositoryStub: Partial<WorkflowRepository> = {
    async create(input) {
      const id = `wf-${repositoryStore.size + 1}`;
      const record: WorkflowRecord = {
        id,
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repositoryStore.set(id, record);
      return record;
    },
    async update(id, input) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      const updated: WorkflowRecord = {
        ...existing,
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(),
        compiledDefinition: existing.compiledDefinition,
      };
      repositoryStore.set(id, updated);
      return updated;
    },
    async findById(id) {
      return repositoryStore.get(id);
    },
    async delete(id) {
      repositoryStore.delete(id);
    },
    async list() {
      return Array.from(repositoryStore.values());
    },
    async saveCompiledDefinition(id, definition) {
      const existing = repositoryStore.get(id);
      if (!existing) {
        throw new Error(`Workflow ${id} not found`);
      }
      const updated: WorkflowRecord = {
        ...existing,
        compiledDefinition: definition,
        updatedAt: new Date(),
      };
      repositoryStore.set(id, updated);
      return updated;
    },
  };

  beforeEach(() => {
    repositoryStore = new Map();
    lastCancelledRun = null;

    const temporalStub: Pick<
      TemporalService,
      'startWorkflow' | 'describeWorkflow' | 'getWorkflowResult' | 'cancelWorkflow' | 'getDefaultTaskQueue'
    > = {
      async startWorkflow(options) {
        return {
          workflowId: options.workflowId ?? 'shipsec-run-controller',
          runId: 'temporal-run-controller',
          taskQueue: options.taskQueue ?? 'shipsec-default',
        };
      },
      async describeWorkflow(ref) {
        const status: WorkflowRunStatus = {
          workflowId: ref.workflowId,
          runId: ref.runId ?? 'temporal-run-controller',
          status: 'RUNNING',
          startTime: now,
          closeTime: undefined,
          historyLength: 0,
          taskQueue: 'shipsec-default',
        };
        return status;
      },
      async getWorkflowResult(ref) {
        return { workflowId: ref.workflowId, success: true };
      },
      async cancelWorkflow(ref) {
        lastCancelledRun = ref;
      },
      getDefaultTaskQueue() {
        return 'shipsec-default';
      },
    };

    const workflowsService = new WorkflowsService(
      repositoryStub as WorkflowRepository,
      temporalStub as TemporalService,
    );
    const traceService = new TraceService();
    controller = new WorkflowsController(workflowsService, traceService);
  });

  it('creates, lists, updates, and retrieves workflows', async () => {
    const created = await controller.create(baseGraph);
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Controller workflow');

    const list = await controller.findAll();
    expect(list).toHaveLength(1);

    const updated = await controller.update(created.id, {
      ...baseGraph,
      name: 'Updated workflow',
    });
    expect(updated.name).toBe('Updated workflow');

    const fetched = await controller.findOne(created.id);
    expect(fetched.id).toBe(created.id);

    const response = await controller.remove(created.id);
    expect(response).toEqual({ status: 'deleted', id: created.id });
  });

  it('commits, starts, and inspects workflow runs', async () => {
    const created = await controller.create(baseGraph);

    const definition = await controller.commit(created.id);
    expect(definition.actions).toHaveLength(2);

    const run = await controller.run(created.id, {
      inputs: { payload: { note: 'hello' } },
    });
    expect(run.runId).toMatch(/^shipsec-run-/);
    expect(run.temporalRunId).toBe('temporal-run-controller');
    expect(run.status).toBe('RUNNING');
    expect(run.taskQueue).toBe('shipsec-default');

    const status = await controller.status(run.runId, run.temporalRunId);
    expect(status.runId).toBe('temporal-run-controller');

    const result = await controller.result(run.runId, run.temporalRunId);
    expect(result).toEqual({
      runId: run.runId,
      result: { workflowId: run.runId, success: true },
    });

    const cancelResponse = await controller.cancel(run.runId, run.temporalRunId);
    expect(cancelResponse).toEqual({ status: 'cancelled', runId: run.runId });
    expect(lastCancelledRun).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });

    const trace = await controller.trace(run.runId);
    expect(trace.runId).toBe(run.runId);
    expect(trace.events).toHaveLength(0);
  });
});
