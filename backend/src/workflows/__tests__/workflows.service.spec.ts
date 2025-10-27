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
      position: { x: 0, y: 0 },
      data: {
        label: 'Trigger',
        config: {
          runtimeInputs: [
            { id: 'fileId', label: 'File ID', type: 'text', required: true },
          ],
        },
      },
    },
    {
      id: 'loader',
      type: 'core.file.loader',
      position: { x: 0, y: 100 },
      data: {
        label: 'Loader',
        config: {
          fileId: '00000000-0000-4000-8000-000000000001',
        },
      },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'trigger',
      target: 'loader',
      sourceHandle: 'fileId',
      targetHandle: 'fileId',
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
  let storedRunMeta: any = null;
  let completedCount = 0;

  type MockWorkflowVersion = {
    id: string;
    workflowId: string;
    version: number;
    graph: typeof sampleGraph;
    compiledDefinition: WorkflowDefinition | null;
    createdAt: Date;
  };

  let workflowVersionSeq = 0;
  let workflowVersionStore = new Map<string, MockWorkflowVersion>();
  const workflowVersionsByWorkflow = new Map<string, MockWorkflowVersion[]>();

  const resetWorkflowVersions = () => {
    workflowVersionSeq = 0;
    workflowVersionStore = new Map();
    workflowVersionsByWorkflow.clear();
  };

  const createWorkflowVersionRecord = (
    workflowId: string,
    graph: typeof sampleGraph = sampleGraph,
  ): MockWorkflowVersion => {
    workflowVersionSeq += 1;
    const record: MockWorkflowVersion = {
      id: `version-${workflowVersionSeq}`,
      workflowId,
      version: workflowVersionSeq,
      graph,
      compiledDefinition: null,
      createdAt: new Date(now),
    };
    workflowVersionStore.set(record.id, record);
    const list = workflowVersionsByWorkflow.get(workflowId) ?? [];
    workflowVersionsByWorkflow.set(workflowId, [...list, record]);
    return record;
  };

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
    async incrementRunCount() {
      return;
    },
  } as unknown as WorkflowRepository;

  const versionRepositoryMock = {
    async create(input: { workflowId: string; graph: typeof sampleGraph }) {
      return createWorkflowVersionRecord(input.workflowId, input.graph);
    },
    async findLatestByWorkflowId(workflowId: string) {
      const list = workflowVersionsByWorkflow.get(workflowId);
      return list ? list[list.length - 1] : undefined;
    },
    async findById(id: string) {
      return workflowVersionStore.get(id);
    },
    async findByWorkflowAndVersion(input: { workflowId: string; version: number }) {
      const list = workflowVersionsByWorkflow.get(input.workflowId);
      return list?.find((record) => record.version === input.version);
    },
    async setCompiledDefinition(id: string, definition: WorkflowDefinition) {
      const record = workflowVersionStore.get(id);
      if (!record) {
        return undefined;
      }
      record.compiledDefinition = definition;
      return record;
    },
  };

  const runRepositoryMock = {
    async upsert(data: {
      runId: string;
      workflowId: string;
      workflowVersionId: string;
      workflowVersion: number;
      temporalRunId: string;
      totalActions: number;
    }) {
      storedRunMeta = {
        runId: data.runId,
        workflowId: data.workflowId,
        workflowVersionId: data.workflowVersionId,
        workflowVersion: data.workflowVersion,
        temporalRunId: data.temporalRunId,
        totalActions: data.totalActions,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
      return storedRunMeta;
    },
    async findByRunId(runId: string) {
      if (storedRunMeta && storedRunMeta.runId === runId) {
        return storedRunMeta;
      }
      return undefined;
    },
  };

  const traceRepositoryMock = {
    async countByType(runId: string, type: string) {
      if (type === 'NODE_COMPLETED' && storedRunMeta?.runId === runId) {
        return completedCount;
      }
      return 0;
    },
  };

  const buildTemporalStub = (overrides?: Partial<WorkflowRunStatus>) => {
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
        const base: WorkflowRunStatus = {
          workflowId: ref.workflowId,
          runId: ref.runId ?? 'temporal-run-mock',
          status: 'RUNNING',
          startTime: now,
          closeTime: undefined,
          historyLength: 0,
          taskQueue: 'shipsec-default',
          failure: undefined,
        };
        return { ...base, ...overrides };
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

    return temporalStub as TemporalService;
  };

  beforeEach(() => {
    createCalls = 0;
    startCalls = [];
    lastDescribeRef = null;
    lastCancelRef = null;
    savedDefinition = null;
    storedRunMeta = null;
    completedCount = 0;
    resetWorkflowVersions();

    const temporalService = buildTemporalStub();
    service = new WorkflowsService(
      repositoryMock,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      temporalService,
    );
  });

  it('creates a workflow using the repository', async () => {
    const created = await service.create(sampleGraph);
    expect(created.id).toBe('workflow-id');
    expect(createCalls).toBe(1);
    expect(created.currentVersion).toBe(1);
    expect(created.currentVersionId).toBeDefined();
  });

  it('commits a workflow definition', async () => {
    await service.create(sampleGraph);
    const definition = await service.commit('workflow-id');
    expect(definition.actions.length).toBeGreaterThan(0);
    expect(savedDefinition).toEqual(definition);
    const latestVersion = versionRepositoryMock.findLatestByWorkflowId
      ? await versionRepositoryMock.findLatestByWorkflowId('workflow-id')
      : undefined;
    expect(latestVersion?.compiledDefinition).toEqual(definition);
  });

  it('runs a workflow definition via the Temporal service', async () => {
    const created = await service.create(sampleGraph);
    const definition = compileWorkflowGraph(sampleGraph);
    repositoryMock.findById = async () => ({
      id: 'workflow-id',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      name: sampleGraph.name,
      description: sampleGraph.description ?? null,
      graph: sampleGraph,
      compiledDefinition: definition,
      lastRun: null,
      runCount: 0,
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
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      totalActions: definition.actions.length,
    });
    expect(run.workflowVersionId).toEqual(created.currentVersionId);
    expect(run.workflowVersion).toEqual(created.currentVersion);
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      workflowVersionId: created.currentVersionId,
      workflowVersion: created.currentVersion,
      totalActions: definition.actions.length,
    });
  });

  it('delegates status, result, and cancel operations to the Temporal service', async () => {
    await service.create(sampleGraph);
    const run = await service.run('workflow-id');
    completedCount = 1;
    const status = await service.getRunStatus(run.runId, run.temporalRunId);
    const result = await service.getRunResult(run.runId, run.temporalRunId);
    await service.cancelRun(run.runId, run.temporalRunId);

    expect(status.runId).toBe(run.runId);
    expect(status.workflowId).toBe('workflow-id');
    expect(status.status).toBe('RUNNING');
    expect(status.taskQueue).toBe('shipsec-default');
    expect(status.progress).toEqual({ completedActions: 1, totalActions: 2 });
    expect(status.failure).toBeUndefined();
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

  it('maps failure details into a failure summary', async () => {
    resetWorkflowVersions();
    const failureTemporalService = buildTemporalStub({
      status: 'FAILED',
      closeTime: now,
      failure: {
        message: 'Component crashed',
        stackTrace: 'Error: boom',
        applicationFailureInfo: {
          type: 'ComponentError',
          details: { node: 'node-1' },
        },
      },
    });

    service = new WorkflowsService(
      repositoryMock,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      failureTemporalService,
    );

    const versionRecord = createWorkflowVersionRecord('workflow-id');

    storedRunMeta = {
      runId: 'shipsec-run-fail',
      workflowId: 'workflow-id',
      workflowVersionId: versionRecord.id,
      workflowVersion: versionRecord.version,
      temporalRunId: 'temporal-run-mock',
      totalActions: 2,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    const status = await service.getRunStatus('shipsec-run-fail');
    expect(status.status).toBe('FAILED');
    expect(status.failure).toEqual({
      reason: 'Component crashed',
      temporalCode: 'ComponentError',
      details: {
        stackTrace: 'Error: boom',
        applicationFailureDetails: { node: 'node-1' },
      },
    });
  });
});
