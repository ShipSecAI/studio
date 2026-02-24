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
