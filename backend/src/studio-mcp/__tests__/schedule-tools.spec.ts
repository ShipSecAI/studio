import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpService } from '../studio-mcp.service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import type { WorkflowsService } from '../../workflows/workflows.service';

type RegisteredToolsMap = Record<string, any>;

function getRegisteredTools(server: McpServer): RegisteredToolsMap {
  return (server as unknown as { _registeredTools: RegisteredToolsMap })._registeredTools;
}

const mockAuth: AuthContext = {
  userId: 'test-user-id',
  organizationId: 'test-org-id',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const restrictedAuth: AuthContext = {
  ...mockAuth,
  provider: 'api-key',
  apiKeyPermissions: {
    workflows: { run: false, list: false, read: false },
    runs: { read: false, cancel: false },
    audit: { read: false },
    schedules: { create: false, list: false, read: false, update: false, delete: false },
    secrets: { create: false, list: false, read: false, update: false, delete: false },
    'human-inputs': { read: false, resolve: false },
  },
};

function makeWorkflowsService(): WorkflowsService {
  return {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'wf-id' }),
    update: jest.fn().mockResolvedValue({ id: 'wf-id' }),
    updateMetadata: jest.fn().mockResolvedValue({ id: 'wf-id' }),
    delete: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue({ runId: 'run-id', status: 'RUNNING' }),
    listRuns: jest.fn().mockResolvedValue({ runs: [] }),
    getRunStatus: jest.fn().mockResolvedValue({ runId: 'run-id', status: 'RUNNING' }),
    getRunResult: jest.fn().mockResolvedValue({}),
    cancelRun: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowsService;
}

describe('Schedule Tools', () => {
  let service: StudioMcpService;
  let schedulesService: any;
  let workflowsService: WorkflowsService;

  beforeEach(() => {
    workflowsService = makeWorkflowsService();
    schedulesService = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: 'sched-id' }),
      create: jest.fn().mockResolvedValue({ id: 'sched-id', name: 'My Schedule' }),
      update: jest.fn().mockResolvedValue({ id: 'sched-id', name: 'Updated' }),
      delete: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue({ id: 'sched-id', status: 'paused' }),
      resume: jest.fn().mockResolvedValue({ id: 'sched-id', status: 'active' }),
      trigger: jest.fn().mockResolvedValue(undefined),
    };
    service = new StudioMcpService(
      workflowsService,
      undefined,
      undefined,
      undefined,
      undefined,
      schedulesService,
    );
  });

  it('create_schedule maps inputs to inputPayload.runtimeInputs (not flat inputs field)', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['create_schedule'].handler({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Daily Run',
      cronExpression: '0 9 * * 1',
      inputs: { foo: 'bar', count: 42 },
      timezone: 'America/New_York',
      description: 'Weekly schedule',
    });

    expect(schedulesService.create).toHaveBeenCalledTimes(1);
    const [calledAuth, dto] = schedulesService.create.mock.calls[0];
    expect(calledAuth).toBe(mockAuth);
    // CRITICAL: inputs must be nested under inputPayload.runtimeInputs
    expect(dto.inputPayload).toBeDefined();
    expect(dto.inputPayload.runtimeInputs).toEqual({ foo: 'bar', count: 42 });
    expect(dto.inputPayload.nodeOverrides).toEqual({});
    // Flat inputs field must NOT exist on the dto
    expect(dto.inputs).toBeUndefined();
    expect(dto.name).toBe('Daily Run');
    expect(dto.cronExpression).toBe('0 9 * * 1');
    expect(dto.timezone).toBe('America/New_York');
    expect(dto.description).toBe('Weekly schedule');
  });

  it('create_schedule defaults timezone to UTC when not provided', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['create_schedule'].handler({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'No TZ',
      cronExpression: '0 0 * * *',
    });

    const [, dto] = schedulesService.create.mock.calls[0];
    expect(dto.timezone).toBe('UTC');
    expect(dto.inputPayload.runtimeInputs).toEqual({});
  });

  it('update_schedule maps inputs to inputPayload correctly', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['update_schedule'].handler({
      scheduleId: 'sched-123',
      inputs: { newKey: 'newVal' },
      name: 'Renamed',
    });

    expect(schedulesService.update).toHaveBeenCalledTimes(1);
    const [calledAuth, scheduleId, dto] = schedulesService.update.mock.calls[0];
    expect(calledAuth).toBe(mockAuth);
    expect(scheduleId).toBe('sched-123');
    expect(dto.inputPayload).toEqual({ runtimeInputs: { newKey: 'newVal' }, nodeOverrides: {} });
    expect(dto.name).toBe('Renamed');
    // Flat inputs field must NOT exist
    expect(dto.inputs).toBeUndefined();
  });

  it('trigger_schedule returns { triggered: true, scheduleId } since service returns void', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    const result = await tools['trigger_schedule'].handler({ scheduleId: 'sched-abc' });
    const parsed = JSON.parse(result.content[0].text);

    expect(schedulesService.trigger).toHaveBeenCalledWith(mockAuth, 'sched-abc');
    expect(parsed.triggered).toBe(true);
    expect(parsed.scheduleId).toBe('sched-abc');
    expect(result.isError).toBeUndefined();
  });

  it('delete_schedule calls delete and returns { deleted: true, scheduleId }', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    const result = await tools['delete_schedule'].handler({ scheduleId: 'sched-del' });
    const parsed = JSON.parse(result.content[0].text);

    expect(schedulesService.delete).toHaveBeenCalledWith(mockAuth, 'sched-del');
    expect(parsed.deleted).toBe(true);
    expect(parsed.scheduleId).toBe('sched-del');
    expect(result.isError).toBeUndefined();
  });

  it('list_schedules passes auth and optional workflowId filter', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    // Without filter
    await tools['list_schedules'].handler({});
    expect(schedulesService.list).toHaveBeenCalledWith(mockAuth, undefined);

    schedulesService.list.mockClear();

    // With workflowId filter
    await tools['list_schedules'].handler({ workflowId: '11111111-1111-4111-8111-111111111111' });
    expect(schedulesService.list).toHaveBeenCalledWith(mockAuth, {
      workflowId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('schedules.create = false → denied', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['create_schedule'].handler({
      workflowId: '11111111-1111-4111-8111-111111111111',
      name: 'Blocked',
      cronExpression: '0 9 * * *',
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('schedules.create');
    expect(schedulesService.create).not.toHaveBeenCalled();
  });

  it('schedules.list = false → denied', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['list_schedules'].handler({})) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('schedules.list');
    expect(schedulesService.list).not.toHaveBeenCalled();
  });
});
