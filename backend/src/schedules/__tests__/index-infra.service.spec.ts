import { describe, expect, it, mock } from 'bun:test';

import { INDEX_INFRA_TEMPLATE_SLUG, IndexInfraService } from '../index-infra.service';

const auth = {
  userId: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'local',
} as const;

function createService(overrides: {
  list?: ReturnType<typeof mock>;
  create?: ReturnType<typeof mock>;
  update?: ReturnType<typeof mock>;
  findById?: ReturnType<typeof mock>;
}) {
  const schedulesService = {
    list: overrides.list ?? mock(() => Promise.resolve([])),
    create:
      overrides.create ??
      mock((_: unknown, input: any) =>
        Promise.resolve({
          id: 'schedule-1',
          ...input,
          inputPayload: input.inputPayload,
        }),
      ),
    update:
      overrides.update ??
      mock((_: unknown, __: string, input: any) =>
        Promise.resolve({
          id: 'schedule-1',
          ...input,
          inputPayload: input.inputPayload,
        }),
      ),
  };

  const workflowsService = {
    findById:
      overrides.findById ?? mock(() => Promise.resolve({ id: 'wf-1', currentVersionId: 'v1' })),
    run: mock(() => Promise.resolve({ workflowId: 'wf-1', runId: 'run-1' })),
  };

  const systemWorkflowsService = {
    ensureSystemWorkflows: mock(() =>
      Promise.resolve([{ id: 'wf-1', name: 'Index Infra', slug: INDEX_INFRA_TEMPLATE_SLUG }]),
    ),
  };

  return {
    service: new IndexInfraService(
      schedulesService as any,
      systemWorkflowsService as any,
      workflowsService as any,
    ),
    schedulesService,
  };
}

describe('IndexInfraService.ensureDefaultScheduleForIntegration', () => {
  it('creates default schedule without pinning integrationId in runtime inputs', async () => {
    const create = mock((_: unknown, input: any) =>
      Promise.resolve({
        id: 'schedule-1',
        ...input,
      }),
    );
    const { service } = createService({ create });

    const schedule = await service.ensureDefaultScheduleForIntegration(auth as any, 'conn-123');
    expect(schedule.inputPayload?.runtimeInputs ?? {}).toEqual({});
  });

  it('removes pinned integrationId from existing default schedule runtime inputs', async () => {
    const update = mock((_: unknown, __: string, input: any) =>
      Promise.resolve({
        id: 'schedule-1',
        ...input,
      }),
    );
    const { service, schedulesService } = createService({
      list: mock(() =>
        Promise.resolve([
          {
            id: 'schedule-1',
            workflowVersionId: 'v1',
            name: 'Index Infra',
            cronExpression: '0 2 * * *',
            timezone: 'UTC',
            humanLabel: 'Daily',
            inputPayload: { runtimeInputs: { integrationId: 'conn-old' }, nodeOverrides: {} },
          },
        ]),
      ),
      update,
    });

    const schedule = await service.ensureDefaultScheduleForIntegration(auth as any, 'conn-new');
    expect(schedule.inputPayload.runtimeInputs).toEqual({});
    expect(schedulesService.update).toHaveBeenCalledTimes(1);
  });
});
