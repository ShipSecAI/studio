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
