import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '@shipsec/studio-worker/components'; // Register components
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
import type { AuthContext } from '../../auth/types';
import type { ExecutionInputPreview, ExecutionTriggerType } from '@shipsec/shared';

const TEST_ORG = 'test-org';
const authContext: AuthContext = {
  userId: 'service-user',
  organizationId: TEST_ORG,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const sampleGraph = WorkflowGraphSchema.parse({
  name: 'Sample workflow',
  nodes: [
    {
      id: 'trigger',
      type: 'core.workflow.entrypoint',
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
          fileId: '11111111-1111-4111-8111-111111111111',
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
    organizationId: string | null;
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
    organizationId: string | null = TEST_ORG,
  ): MockWorkflowVersion => {
    workflowVersionSeq += 1;
    const record: MockWorkflowVersion = {
      id: `version-${workflowVersionSeq}`,
      workflowId,
      version: workflowVersionSeq,
      graph,
      compiledDefinition: null,
      createdAt: new Date(now),
      organizationId,
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
        organizationId: TEST_ORG,
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
        organizationId: TEST_ORG,
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
        organizationId: TEST_ORG,
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
        organizationId: TEST_ORG,
      };
    },
    async incrementRunCount() {
      return;
    },
  } as unknown as WorkflowRepository;

  const versionRepositoryMock = {
    async create(
      input: { workflowId: string; graph: typeof sampleGraph },
      options: { organizationId?: string | null } = {},
    ) {
      return createWorkflowVersionRecord(
        input.workflowId,
        input.graph,
        options.organizationId ?? TEST_ORG,
      );
    },
    async findLatestByWorkflowId(
      workflowId: string,
      options: { organizationId?: string | null } = {},
    ) {
      const list = workflowVersionsByWorkflow.get(workflowId) ?? [];
      const filtered = options.organizationId
        ? list.filter((record) => record.organizationId === options.organizationId)
        : list;
      return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
    },
    async findById(id: string, options: { organizationId?: string | null } = {}) {
      const record = workflowVersionStore.get(id);
      if (!record) return undefined;
      if (options.organizationId && record.organizationId !== options.organizationId) {
        return undefined;
      }
      return record;
    },
    async findByWorkflowAndVersion(
      input: { workflowId: string; version: number; organizationId?: string | null },
    ) {
      const list = workflowVersionsByWorkflow.get(input.workflowId) ?? [];
      return list.find(
        (record) =>
          record.version === input.version &&
          (!input.organizationId || record.organizationId === input.organizationId),
      );
    },
    async setCompiledDefinition(
      id: string,
      definition: WorkflowDefinition,
      options: { organizationId?: string | null } = {},
    ) {
      const record = workflowVersionStore.get(id);
      if (!record) {
        return undefined;
      }
      if (options.organizationId && record.organizationId !== options.organizationId) {
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
      totalActions: number;
      inputs?: Record<string, unknown>;
      organizationId?: string | null;
      triggerType?: ExecutionTriggerType;
      triggerSource?: string | null;
      triggerLabel?: string | null;
      inputPreview?: ExecutionInputPreview;
    }) {
      storedRunMeta = {
        runId: data.runId,
        workflowId: data.workflowId,
        workflowVersionId: data.workflowVersionId,
        workflowVersion: data.workflowVersion,
        totalActions: data.totalActions,
        inputs: data.inputs ?? {},
        createdAt: new Date(now),
        updatedAt: new Date(now),
        organizationId: data.organizationId ?? TEST_ORG,
        triggerType: data.triggerType ?? 'manual',
        triggerSource: data.triggerSource ?? null,
        triggerLabel: data.triggerLabel ?? null,
        inputPreview: data.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      };
      return storedRunMeta;
    },
    async findByRunId(runId: string, options: { organizationId?: string | null } = {}) {
      if (storedRunMeta && storedRunMeta.runId === runId) {
        if (options.organizationId && storedRunMeta.organizationId !== options.organizationId) {
          return undefined;
        }
        return storedRunMeta;
      }
      return undefined;
    },
    async list(options: { workflowId?: string; organizationId?: string | null } = {}) {
      if (!storedRunMeta) {
        return [];
      }
      if (options.workflowId && storedRunMeta.workflowId !== options.workflowId) {
        return [];
      }
      if (options.organizationId && storedRunMeta.organizationId !== options.organizationId) {
        return [];
      }
      return [storedRunMeta];
    },
    async hasPendingInputs() {
      return false;
    },
  };

  const traceRepositoryMock = {
    async countByType(runId: string, type: string) {
      if (!storedRunMeta || storedRunMeta.runId !== runId) {
        return 0;
      }
      if (type === 'NODE_COMPLETED') {
        return completedCount;
      }
      if (type === 'NODE_STARTED') {
        return storedRunMeta.totalActions ?? 0;
      }
      return 0;
    },
    async getEventTimeRange(runId: string) {
      if (!storedRunMeta || storedRunMeta.runId !== runId) {
        return null;
      }
      const base = Date.now();
      return {
        earliest: base - 1000,
        latest: base,
      };
    },
  };

  const workflowRoleRepositoryMock = {
    async upsert() {
      return;
    },
    async hasRole() {
      return false;
    },
  };

  const analyticsServiceMock = {
    trackWorkflowStarted: vi.fn(),
    trackWorkflowCompleted: vi.fn(),
    trackComponentExecuted: vi.fn(),
    trackApiCall: vi.fn(),
    track: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(true),
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
      workflowRoleRepositoryMock as any,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      temporalService,
      analyticsServiceMock as any,
    );
  });

  it('creates a workflow using the repository', async () => {
    const created = await service.create(sampleGraph, authContext);
    expect(created.id).toBe('workflow-id');
    expect(createCalls).toBe(1);
    expect(created.currentVersion).toBe(1);
    expect(created.currentVersionId).toBeDefined();
  });

  it('commits a workflow definition', async () => {
    await service.create(sampleGraph, authContext);
    const definition = await service.commit('workflow-id', authContext);
    expect(definition.actions.length).toBeGreaterThan(0);
    expect(savedDefinition).toEqual(definition);
    const latestVersion = versionRepositoryMock.findLatestByWorkflowId
      ? await versionRepositoryMock.findLatestByWorkflowId('workflow-id')
      : undefined;
    expect(latestVersion?.compiledDefinition).toEqual(definition);
  });

  it('runs a workflow definition via the Temporal service', async () => {
    const created = await service.create(sampleGraph, authContext);
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
      organizationId: TEST_ORG,
    });

    const run = await service.run('workflow-id', { inputs: { message: 'hi' } }, authContext);

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
      organizationId: TEST_ORG,
    });
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      totalActions: definition.actions.length,
      organizationId: TEST_ORG,
    });
    if (created.currentVersionId === null || created.currentVersion === null) {
      throw new Error('Expected workflow version to be assigned');
    }
    const currentVersionId = created.currentVersionId;
    const currentVersionNumber = created.currentVersion;
    expect(run.workflowVersionId).toEqual(currentVersionId);
    expect(run.workflowVersion).toEqual(currentVersionNumber);
    expect(storedRunMeta).toMatchObject({
      runId: run.runId,
      workflowId: 'workflow-id',
      workflowVersionId: currentVersionId,
      workflowVersion: currentVersionNumber,
      totalActions: definition.actions.length,
      organizationId: TEST_ORG,
    });
  });

  it('returns run metadata via getRun', async () => {
    await service.create(sampleGraph, authContext);
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
      organizationId: TEST_ORG,
    });

    const run = await service.run('workflow-id', { inputs: { foo: 'bar' } }, authContext);
    const summary = await service.getRun(run.runId, authContext);

    expect(summary.id).toBe(run.runId);
    expect(summary.workflowId).toBe('workflow-id');
    expect(summary.workflowName).toBe(sampleGraph.name);
    expect(summary.nodeCount).toBeGreaterThan(0);
    expect(summary.eventCount).toBeGreaterThanOrEqual(0);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
    expect(summary.status).toBe('RUNNING');
  });

  it('prepares run payloads with trigger metadata and idempotent run ids', async () => {
    await service.create(sampleGraph, authContext);
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
      organizationId: TEST_ORG,
    });

    const trigger = {
      type: 'schedule',
      sourceId: 'schedule-123',
      label: 'Nightly quick scan',
    } as const;

    const first = await service.prepareRunPayload(
      'workflow-id',
      { inputs: { domain: 'acme.com' } },
      authContext,
      { trigger, idempotencyKey: 'phase-8-key' },
    );

    expect(first.triggerMetadata).toEqual(trigger);
    expect(first.inputPreview.runtimeInputs).toEqual({ domain: 'acme.com' });
    expect(storedRunMeta).toMatchObject({
      triggerType: 'schedule',
      triggerSource: 'schedule-123',
      triggerLabel: 'Nightly quick scan',
    });

    const second = await service.prepareRunPayload(
      'workflow-id',
      { inputs: { domain: 'acme.com' } },
      authContext,
      { trigger, idempotencyKey: 'phase-8-key' },
    );

    expect(second.runId).toBe(first.runId);
  });

  it('delegates status, result, and cancel operations to the Temporal service', async () => {
    await service.create(sampleGraph, authContext);
    const run = await service.run('workflow-id', {}, authContext);
    completedCount = 1;
    const status = await service.getRunStatus(run.runId, run.temporalRunId, authContext);
    const result = await service.getRunResult(run.runId, run.temporalRunId, authContext);
    await service.cancelRun(run.runId, run.temporalRunId, authContext);

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

  it('returns stored inputs and version metadata via getRunConfig', async () => {
    await service.create(sampleGraph, authContext);
    const run = await service.run('workflow-id', { inputs: { answer: 42 } }, authContext);
    const config = await service.getRunConfig(run.runId, authContext);
    expect(config).toMatchObject({
      runId: run.runId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      workflowVersion: run.workflowVersion,
      inputs: { answer: 42 },
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
      workflowRoleRepositoryMock as any,
      versionRepositoryMock as any,
      runRepositoryMock as any,
      traceRepositoryMock as any,
      failureTemporalService,
      analyticsServiceMock as any,
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
      organizationId: TEST_ORG,
    };

    const status = await service.getRunStatus('shipsec-run-fail', undefined, authContext);
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
