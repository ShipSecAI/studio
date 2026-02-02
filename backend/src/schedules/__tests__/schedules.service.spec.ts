import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'bun:test';

import type { ScheduleInputPayload } from '@shipsec/shared';
import type { AuthContext } from '../../auth/types';
import type { WorkflowDefinition } from '../../dsl/types';
import type { WorkflowScheduleRecord } from '../../database/schema';
import type { ScheduleRepository } from '../repository/schedule.repository';
import { SchedulesService } from '../schedules.service';
import type { TemporalService } from '../../temporal/temporal.service';
import type { WorkflowsService } from '../../workflows/workflows.service';

const authContext: AuthContext = {
  userId: 'admin-user',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  provider: 'local',
  isAuthenticated: true,
};

const workflowDefinition: WorkflowDefinition = {
  version: 2,
  title: 'Entry workflow',
  description: 'Valid workflow with entry point',
  entrypoint: { ref: 'entry' },
  nodes: {},
  edges: [],
  dependencyCounts: {
    entry: 0,
    scanner: 1,
  },
  actions: [
    {
      ref: 'entry',
      componentId: 'core.workflow.entrypoint',
      params: {
        runtimeInputs: [{ id: 'domain', label: 'Domain', required: true }],
      },
      inputOverrides: {},
      dependsOn: [],
      inputMappings: {},
    },
    {
      ref: 'scanner',
      componentId: 'security.dnsx',
      params: {},
      inputOverrides: {},
      dependsOn: ['entry'],
      inputMappings: {},
    },
  ],
  config: {
    environment: 'default',
    timeoutSeconds: 0,
  },
};

const makeScheduleRecord = (
  overrides: Partial<WorkflowScheduleRecord> = {},
): WorkflowScheduleRecord => {
  const now = new Date();
  return {
    id: overrides.id ?? 'schedule-1',
    workflowId: overrides.workflowId ?? 'workflow-1',
    workflowVersionId: overrides.workflowVersionId ?? 'version-1',
    workflowVersion: overrides.workflowVersion ?? 1,
    name: overrides.name ?? 'Daily quick scan',
    description: overrides.description ?? null,
    cronExpression: overrides.cronExpression ?? '0 9 * * *',
    timezone: overrides.timezone ?? 'UTC',
    humanLabel: overrides.humanLabel ?? null,
    overlapPolicy: overrides.overlapPolicy ?? 'skip',
    catchupWindowSeconds: overrides.catchupWindowSeconds ?? 0,
    status: overrides.status ?? 'active',
    lastRunAt: overrides.lastRunAt ?? null,
    nextRunAt: overrides.nextRunAt ?? null,
    inputPayload:
      overrides.inputPayload ??
      ({
        runtimeInputs: { domain: 'acme.com' },
        nodeOverrides: {},
      } satisfies ScheduleInputPayload),
    temporalScheduleId: overrides.temporalScheduleId ?? null,
    temporalSnapshot: overrides.temporalSnapshot ?? {},
    organizationId: overrides.organizationId ?? 'org-1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
};

class InMemoryScheduleRepository implements Partial<ScheduleRepository> {
  private records = new Map<string, WorkflowScheduleRecord>();
  private seq = 0;

  async create(values: Partial<WorkflowScheduleRecord>): Promise<WorkflowScheduleRecord> {
    this.seq += 1;
    const record = makeScheduleRecord({
      ...values,
      id: values.id ?? `schedule-${this.seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.records.set(record.id, record);
    return record;
  }

  async update(
    id: string,
    values: Partial<WorkflowScheduleRecord>,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowScheduleRecord | undefined> {
    const existing = await this.findById(id, options);
    if (!existing) {
      return undefined;
    }
    const updated = {
      ...existing,
      ...values,
      updatedAt: new Date(),
    };
    this.records.set(id, updated);
    return updated;
  }

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowScheduleRecord | undefined> {
    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }
    if (options.organizationId && record.organizationId !== options.organizationId) {
      return undefined;
    }
    return record;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(filters: { workflowId?: string; organizationId?: string | null } = {}) {
    return Array.from(this.records.values()).filter((record) => {
      if (filters.workflowId && record.workflowId !== filters.workflowId) {
        return false;
      }
      if (filters.organizationId && record.organizationId !== filters.organizationId) {
        return false;
      }
      return true;
    });
  }
}

describe('SchedulesService', () => {
  let repository: InMemoryScheduleRepository;
  let service: SchedulesService;

  const ensureWorkflowAdminAccessCalls: unknown[][] = [];
  const ensureWorkflowAdminAccess = async (...args: unknown[]) => {
    ensureWorkflowAdminAccessCalls.push(args);
  };

  const getCompiledWorkflowContextCalls: unknown[][] = [];
  const getCompiledWorkflowContext = async (...args: unknown[]) => {
    getCompiledWorkflowContextCalls.push(args);
    return {
      workflow: {
        id: 'workflow-1',
        name: 'Test workflow',
        organizationId: 'org-1',
      },
      version: {
        id: 'version-1',
        workflowId: 'workflow-1',
        version: 1,
      },
      definition: workflowDefinition,
      organizationId: 'org-1',
    };
  };

  const prepareRunPayloadCalls: unknown[][] = [];
  const prepareRunPayload = async (...args: unknown[]) => {
    prepareRunPayloadCalls.push(args);
    return { runId: 'shipsec-run-123' };
  };

  const startPreparedRunCalls: unknown[][] = [];
  const startPreparedRun = async (...args: unknown[]) => {
    startPreparedRunCalls.push(args);
  };

  const workflowsService = {
    ensureWorkflowAdminAccess,
    getCompiledWorkflowContext,
    prepareRunPayload,
    startPreparedRun,
  } as unknown as WorkflowsService;

  const createScheduleCalls: unknown[] = [];
  const updateScheduleCalls: unknown[] = [];
  const pauseScheduleCalls: unknown[][] = [];
  const resumeScheduleCalls: unknown[][] = [];

  const createSchedule = async (input: unknown) => {
    createScheduleCalls.push(input);
  };
  const updateSchedule = async (input: unknown) => {
    updateScheduleCalls.push(input);
  };
  const deleteSchedule = async () => {};
  const pauseSchedule = async (...args: unknown[]) => {
    pauseScheduleCalls.push(args);
  };
  const resumeSchedule = async (...args: unknown[]) => {
    resumeScheduleCalls.push(args);
  };

  const temporalService = {
    createSchedule,
    updateSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
  } as unknown as TemporalService;

  beforeEach(() => {
    repository = new InMemoryScheduleRepository();
    service = new SchedulesService(
      repository as unknown as ScheduleRepository,
      workflowsService,
      temporalService,
    );
    ensureWorkflowAdminAccessCalls.length = 0;
    getCompiledWorkflowContextCalls.length = 0;
    prepareRunPayloadCalls.length = 0;
    startPreparedRunCalls.length = 0;
    createScheduleCalls.length = 0;
    updateScheduleCalls.length = 0;
    pauseScheduleCalls.length = 0;
    resumeScheduleCalls.length = 0;
  });

  it('creates schedules with validated payloads and registers Temporal schedules', async () => {
    const schedule = await service.create(authContext, {
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      name: 'Daily Quick Scan',
      description: 'Morning cadence',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      catchupWindowSeconds: 0,
      overlapPolicy: 'skip',
      inputPayload: {
        runtimeInputs: { domain: 'acme.com' },
        nodeOverrides: { scanner: { params: { depth: 3 }, inputOverrides: {} } },
      },
    });

    expect(schedule.name).toBe('Daily Quick Scan');
    expect(schedule.inputPayload?.runtimeInputs?.domain).toBe('acme.com');
    expect(createScheduleCalls.length).toBe(1);
    expect(createScheduleCalls[0]).toMatchObject({
      scheduleId: schedule.id,
      cronExpression: '0 9 * * *',
      dispatchArgs: {
        workflowId: 'workflow-1',
        scheduleId: schedule.id,
        runtimeInputs: { domain: 'acme.com' },
        nodeOverrides: { scanner: { params: { depth: 3 }, inputOverrides: {} } },
        trigger: {
          type: 'schedule',
          sourceId: schedule.id,
          label: 'Daily Quick Scan',
        },
      },
    });
  });

  it('rejects schedules that miss required runtime inputs', async () => {
    await expect(
      service.create(authContext, {
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        name: 'Invalid',
        cronExpression: '0 10 * * *',
        timezone: 'UTC',
        overlapPolicy: 'skip',
        catchupWindowSeconds: 0,
        inputPayload: {
          runtimeInputs: {},
          nodeOverrides: {},
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createScheduleCalls.length).toBe(0);
  });

  it('updates schedules and propagates Temporal memo + dispatch args', async () => {
    const created = await service.create(authContext, {
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      name: 'Nightly',
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      overlapPolicy: 'skip',
      catchupWindowSeconds: 0,
      inputPayload: {
        runtimeInputs: { domain: 'acme.com' },
        nodeOverrides: {},
      },
    });

    await service.update(authContext, created.id, {
      cronExpression: '0 3 * * *',
      timezone: 'America/New_York',
      name: 'Nightly updated',
      inputPayload: {
        runtimeInputs: { domain: 'example.org' },
        nodeOverrides: { scanner: { params: { timeout: 60 }, inputOverrides: {} } },
      },
    });

    expect(updateScheduleCalls.length).toBe(1);
    expect(updateScheduleCalls[0]).toMatchObject({
      cronExpression: '0 3 * * *',
      timezone: 'America/New_York',
      dispatchArgs: {
        runtimeInputs: { domain: 'example.org' },
        nodeOverrides: { scanner: { params: { timeout: 60 }, inputOverrides: {} } },
      },
    });
  });

  it('pauses, resumes, and triggers schedules through the workflow service', async () => {
    const created = await service.create(authContext, {
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      name: 'Adhoc',
      cronExpression: '*/5 * * * *',
      timezone: 'UTC',
      overlapPolicy: 'skip',
      catchupWindowSeconds: 0,
      inputPayload: {
        runtimeInputs: { domain: 'acme.com' },
        nodeOverrides: { scanner: { params: { depth: 1 }, inputOverrides: {} } },
      },
    });

    const paused = await service.pause(authContext, created.id);
    expect(paused.status).toBe('paused');
    expect(pauseScheduleCalls[0]?.[0]).toBe(created.id);

    const resumed = await service.resume(authContext, created.id);
    expect(resumed.status).toBe('active');
    expect(resumeScheduleCalls[0]?.[0]).toBe(created.id);

    await service.trigger(authContext, created.id);
    expect(prepareRunPayloadCalls[0]?.[2]).toEqual(authContext);
    expect(prepareRunPayloadCalls[0]?.[3]).toMatchObject({
      trigger: {
        type: 'schedule',
        sourceId: created.id,
        label: created.name,
      },
      nodeOverrides: { scanner: { params: { depth: 1 }, inputOverrides: {} } },
    });
    expect(startPreparedRunCalls.length).toBe(1);
  });
});
