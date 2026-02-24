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

// ─── Schedule Tools ───────────────────────────────────────────────────────────

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

// ─── Secret Tools ─────────────────────────────────────────────────────────────

describe('Secret Tools', () => {
  let service: StudioMcpService;
  let secretsService: any;
  let workflowsService: WorkflowsService;

  beforeEach(() => {
    workflowsService = makeWorkflowsService();
    secretsService = {
      listSecrets: jest.fn().mockResolvedValue([{ id: 'sec-1', name: 'MY_SECRET' }]),
      createSecret: jest.fn().mockResolvedValue({ id: 'sec-new', name: 'NEW_SECRET' }),
      rotateSecret: jest.fn().mockResolvedValue({ id: 'sec-1', version: 2 }),
      updateSecret: jest.fn().mockResolvedValue({ id: 'sec-1', name: 'RENAMED' }),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
    };
    service = new StudioMcpService(
      workflowsService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      secretsService,
    );
  });

  it('list_secrets calls secretsService.listSecrets(auth)', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    const result = await tools['list_secrets'].handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(secretsService.listSecrets).toHaveBeenCalledWith(mockAuth);
    expect(Array.isArray(parsed)).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it('create_secret calls secretsService.createSecret(auth, { name, value, description, tags })', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['create_secret'].handler({
      name: 'MY_API_KEY',
      value: 's3cr3t',
      description: 'An API key',
      tags: ['prod', 'external'],
    });

    expect(secretsService.createSecret).toHaveBeenCalledWith(mockAuth, {
      name: 'MY_API_KEY',
      value: 's3cr3t',
      description: 'An API key',
      tags: ['prod', 'external'],
    });
  });

  it('rotate_secret calls secretsService.rotateSecret(auth, secretId, { value })', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['rotate_secret'].handler({
      secretId: 'sec-rotate-me',
      value: 'newvalue123',
    });

    expect(secretsService.rotateSecret).toHaveBeenCalledWith(mockAuth, 'sec-rotate-me', {
      value: 'newvalue123',
    });
  });

  it('delete_secret calls deleteSecret and returns { deleted: true }', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    const result = await tools['delete_secret'].handler({ secretId: 'sec-del' });
    const parsed = JSON.parse(result.content[0].text);

    expect(secretsService.deleteSecret).toHaveBeenCalledWith(mockAuth, 'sec-del');
    expect(parsed.deleted).toBe(true);
    expect(parsed.secretId).toBe('sec-del');
    expect(result.isError).toBeUndefined();
  });

  it('secrets.create = false → denied', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['create_secret'].handler({
      name: 'BLOCKED',
      value: 'nope',
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('secrets.create');
    expect(secretsService.createSecret).not.toHaveBeenCalled();
  });

  it('secrets.list = false → denied', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['list_secrets'].handler({})) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('secrets.list');
    expect(secretsService.listSecrets).not.toHaveBeenCalled();
  });
});

// ─── Human-Input Tools ────────────────────────────────────────────────────────

describe('Human-Input Tools', () => {
  let service: StudioMcpService;
  let humanInputsService: any;
  let workflowsService: WorkflowsService;

  beforeEach(() => {
    workflowsService = makeWorkflowsService();
    humanInputsService = {
      list: jest.fn().mockResolvedValue([{ id: 'hi-1', status: 'pending' }]),
      getById: jest.fn().mockResolvedValue({ id: 'hi-1', status: 'pending' }),
      resolve: jest.fn().mockResolvedValue({ id: 'hi-1', status: 'approved' }),
    };
    service = new StudioMcpService(
      workflowsService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      humanInputsService,
    );
  });

  it('list_human_inputs calls list with status filter and organizationId', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    // With status filter
    await tools['list_human_inputs'].handler({ status: 'pending' });
    expect(humanInputsService.list).toHaveBeenCalledWith(
      { status: 'pending' },
      mockAuth.organizationId,
    );

    humanInputsService.list.mockClear();

    // Without status filter
    await tools['list_human_inputs'].handler({});
    expect(humanInputsService.list).toHaveBeenCalledWith(
      { status: undefined },
      mockAuth.organizationId,
    );
  });

  it('resolve_human_input maps action to responseData.status: approve → approved', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['resolve_human_input'].handler({
      inputId: 'hi-approve',
      action: 'approve',
    });

    expect(humanInputsService.resolve).toHaveBeenCalledTimes(1);
    const [inputId, dto] = humanInputsService.resolve.mock.calls[0];
    expect(inputId).toBe('hi-approve');
    expect(dto.responseData.status).toBe('approved');
  });

  it('resolve_human_input maps action to responseData.status: reject → rejected', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['resolve_human_input'].handler({
      inputId: 'hi-reject',
      action: 'reject',
    });

    const [, dto] = humanInputsService.resolve.mock.calls[0];
    expect(dto.responseData.status).toBe('rejected');
  });

  it('SECURITY: caller-supplied data.status cannot override action (spread order test)', async () => {
    // Pass action: 'reject' but data: { status: 'approved' }
    // The tool must set status AFTER the spread, so action wins.
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['resolve_human_input'].handler({
      inputId: 'hi-security',
      action: 'reject',
      data: { status: 'approved' }, // attacker tries to override to approved
    });

    expect(humanInputsService.resolve).toHaveBeenCalledTimes(1);
    const [, dto] = humanInputsService.resolve.mock.calls[0];
    // The action ('reject') must win — status must be 'rejected', not 'approved'
    expect(dto.responseData.status).toBe('rejected');
  });

  it('resolve_human_input includes respondedBy: auth.userId', async () => {
    const server = service.createServer(mockAuth);
    const tools = getRegisteredTools(server);

    await tools['resolve_human_input'].handler({
      inputId: 'hi-resp',
      action: 'approve',
    });

    const [, dto] = humanInputsService.resolve.mock.calls[0];
    expect(dto.respondedBy).toBe(mockAuth.userId);
  });

  it('human-inputs.resolve = false → denied', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['resolve_human_input'].handler({
      inputId: 'hi-blocked',
      action: 'approve',
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('human-inputs.resolve');
    expect(humanInputsService.resolve).not.toHaveBeenCalled();
  });

  it('human-inputs.read = false → denied on list_human_inputs', async () => {
    const server = service.createServer(restrictedAuth);
    const tools = getRegisteredTools(server);

    const result = (await tools['list_human_inputs'].handler({})) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('human-inputs.read');
    expect(humanInputsService.list).not.toHaveBeenCalled();
  });
});
