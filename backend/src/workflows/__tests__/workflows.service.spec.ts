import { beforeEach, describe, expect, it } from 'bun:test';

import '@shipsec/worker/components'; // Register components
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowDefinition } from '../../dsl/types';
import type {
  StartWorkflowOptions,
  TemporalService,
  WorkflowRunStatus,
} from '../../temporal/temporal.service';
import { WorkflowRepository } from '../repository/workflow.repository';
import { WorkflowsService } from '../workflows.service';

const sampleGraph = WorkflowGraphSchema.parse({
  name: 'Sample workflow',
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
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'trigger',
      target: 'loader',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
});

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let createCalls = 0;
  let startCalls: StartWorkflowOptions[] = [];
  let lastDescribeRef: { workflowId: string; runId?: string } | null = null;
  let lastCancelRef: { workflowId: string; runId?: string } | null = null;
  const now = new Date().toISOString();

  let savedDefinition: WorkflowDefinition | null = null;

  const repositoryMock = {
    async create() {
      createCalls += 1;
      return {
        id: 'workflow-id',
        createdAt: new Date(now),
        updatedAt: new Date(now),
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
        compiledDefinition: null,
      };
    },
    async update() {
      return {
        id: 'workflow-id',
        createdAt: new Date(now),
        updatedAt: new Date(now),
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
        compiledDefinition: null,
      };
    },
    async findById() {
      return {
        id: 'workflow-id',
        createdAt: new Date(now),
        updatedAt: new Date(now),
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
        compiledDefinition: null,
      };
    },
    async delete() {
      return;
    },
    async list() {
      return [];
    },
    async saveCompiledDefinition(_: string, definition: WorkflowDefinition) {
      savedDefinition = definition;
      return {
        id: 'workflow-id',
        createdAt: new Date(now),
        updatedAt: new Date(now),
        name: sampleGraph.name,
        description: sampleGraph.description ?? null,
        graph: sampleGraph,
        compiledDefinition: definition,
      };
    },
  } as unknown as WorkflowRepository;

  const buildTemporalStub = () => {
    const temporalStub: Pick<
      TemporalService,
      'startWorkflow' | 'describeWorkflow' | 'getWorkflowResult' | 'cancelWorkflow' | 'getDefaultTaskQueue'
    > = {
      async startWorkflow(options) {
        startCalls.push(options);
        return {
          workflowId: options.workflowId ?? 'shipsec-run-mock',
          runId: 'temporal-run-mock',
          taskQueue: options.taskQueue ?? 'shipsec-default',
        };
      },
      async describeWorkflow(ref) {
        lastDescribeRef = ref;
        const status: WorkflowRunStatus = {
          workflowId: ref.workflowId,
          runId: ref.runId ?? 'temporal-run-mock',
          status: 'RUNNING',
          startTime: now,
          closeTime: undefined,
          historyLength: 0,
          taskQueue: 'shipsec-default',
        };
        return status;
      },
      async getWorkflowResult(ref) {
        return { workflowId: ref.workflowId, completed: true };
      },
      async cancelWorkflow(ref) {
        lastCancelRef = ref;
      },
      getDefaultTaskQueue() {
        return 'shipsec-default';
      },
    };

    return temporalStub;
  };

  beforeEach(() => {
    createCalls = 0;
    startCalls = [];
    lastDescribeRef = null;
    lastCancelRef = null;
    savedDefinition = null;

    const temporalService = buildTemporalStub();
    service = new WorkflowsService(
      repositoryMock,
      temporalService as TemporalService,
    );
  });

  it('creates a workflow using the repository', async () => {
    const created = await service.create(sampleGraph);
    expect(created.id).toBe('workflow-id');
    expect(createCalls).toBe(1);
  });

  it('commits a workflow definition', async () => {
    const definition = await service.commit('workflow-id');
    expect(definition.actions.length).toBeGreaterThan(0);
    expect(savedDefinition).toEqual(definition);
  });

  it('runs a workflow definition via the Temporal service', async () => {
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () => ({
      id: 'workflow-id',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      name: sampleGraph.name,
      description: sampleGraph.description ?? null,
      graph: sampleGraph,
      compiledDefinition: definition,
    });

    const run = await service.run('workflow-id', { inputs: { message: 'hi' } });

    expect(run.runId).toMatch(/^shipsec-run-/);
    expect(run.workflowId).toBe('workflow-id');
    expect(run.status).toBe('RUNNING');
    expect(run.taskQueue).toBe('shipsec-default');
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0].workflowType).toBe('shipsecWorkflowRun');
    expect(startCalls[0].args?.[0]).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      inputs: { message: 'hi' },
    });
  });

  it('delegates status, result, and cancel operations to the Temporal service', async () => {
    const run = await service.run('workflow-id');
    const status = await service.getRunStatus(run.runId, run.temporalRunId);
    const result = await service.getRunResult(run.runId, run.temporalRunId);
    await service.cancelRun(run.runId, run.temporalRunId);

    expect(status.workflowId).toBe(run.runId);
    expect(result).toMatchObject({ workflowId: run.runId, completed: true });
    expect(lastDescribeRef).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });
    expect(lastCancelRef).toEqual({
      workflowId: run.runId,
      runId: run.temporalRunId,
    });
  });
});
