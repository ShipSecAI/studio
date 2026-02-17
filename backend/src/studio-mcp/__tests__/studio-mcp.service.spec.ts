import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpService } from '../studio-mcp.service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import type { WorkflowsService } from '../../workflows/workflows.service';

// Helper to access private _registeredTools on McpServer (plain object at runtime)
type ToolHandler = (...args: unknown[]) => unknown;
type RegisteredToolsMap = Record<string, { handler: ToolHandler }>;
function getRegisteredTools(server: McpServer): RegisteredToolsMap {
  return (server as unknown as { _registeredTools: RegisteredToolsMap })._registeredTools;
}

describe('StudioMcpService Unit Tests', () => {
  let service: StudioMcpService;
  let workflowsService: WorkflowsService;

  const mockAuthContext: AuthContext = {
    userId: 'test-user-id',
    organizationId: 'test-org-id',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  beforeEach(() => {
    workflowsService = {
      list: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      run: jest.fn().mockResolvedValue({
        runId: 'test-run-id',
        workflowId: 'test-workflow-id',
        status: 'RUNNING',
        workflowVersion: 1,
      }),
      listRuns: jest.fn().mockResolvedValue({ runs: [] }),
      getRunStatus: jest.fn().mockResolvedValue({
        runId: 'test-run-id',
        workflowId: 'test-workflow-id',
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getRunResult: jest.fn().mockResolvedValue({}),
      cancelRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkflowsService;

    service = new StudioMcpService(workflowsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createServer', () => {
    it('returns an McpServer instance', () => {
      const server = service.createServer(mockAuthContext);

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(McpServer);
    });

    it('registers all 9 expected tools', () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);

      expect(registeredTools).toBeDefined();
      expect(Object.keys(registeredTools).length).toBe(9);

      const toolNames = Object.keys(registeredTools).sort();
      expect(toolNames).toEqual([
        'cancel_run',
        'get_component',
        'get_run_result',
        'get_run_status',
        'get_workflow',
        'list_components',
        'list_runs',
        'list_workflows',
        'run_workflow',
      ]);
    });

    it('workflow tools use auth context passed at creation time', async () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const listWorkflowsTool = registeredTools['list_workflows'];

      expect(listWorkflowsTool).toBeDefined();
      await listWorkflowsTool.handler({});

      expect(workflowsService.list).toHaveBeenCalledWith(mockAuthContext);
    });

    it('get_workflow tool uses auth context passed at creation time', async () => {
      const workflowId = '11111111-1111-4111-8111-111111111111';
      (workflowsService.findById as jest.Mock).mockResolvedValue({
        id: workflowId,
        name: 'Test Workflow',
        description: 'Test description',
      });

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const getWorkflowTool = registeredTools['get_workflow'];

      expect(getWorkflowTool).toBeDefined();
      await getWorkflowTool.handler({ workflowId });

      expect(workflowsService.findById).toHaveBeenCalledWith(workflowId, mockAuthContext);
    });

    it('run_workflow tool uses auth context passed at creation time', async () => {
      const workflowId = '11111111-1111-4111-8111-111111111111';
      const inputs = { key: 'value' };

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const runWorkflowTool = registeredTools['run_workflow'];

      expect(runWorkflowTool).toBeDefined();
      await runWorkflowTool.handler({ workflowId, inputs });

      expect(workflowsService.run).toHaveBeenCalledWith(
        workflowId,
        { inputs, versionId: undefined },
        mockAuthContext,
        {
          trigger: {
            type: 'api',
            sourceId: mockAuthContext.userId,
            label: 'Studio MCP',
          },
        },
      );
    });

    it('list_runs tool uses auth context passed at creation time', async () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const listRunsTool = registeredTools['list_runs'];

      expect(listRunsTool).toBeDefined();
      await listRunsTool.handler({});

      expect(workflowsService.listRuns).toHaveBeenCalledWith(mockAuthContext, {
        workflowId: undefined,
        status: undefined,
        limit: 20,
      });
    });

    it('get_run_status tool uses auth context passed at creation time', async () => {
      const runId = 'test-run-id';

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const getRunStatusTool = registeredTools['get_run_status'];

      expect(getRunStatusTool).toBeDefined();
      await getRunStatusTool.handler({ runId });

      expect(workflowsService.getRunStatus).toHaveBeenCalledWith(runId, undefined, mockAuthContext);
    });

    it('get_run_result tool uses auth context passed at creation time', async () => {
      const runId = 'test-run-id';

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const getRunResultTool = registeredTools['get_run_result'];

      expect(getRunResultTool).toBeDefined();
      await getRunResultTool.handler({ runId });

      expect(workflowsService.getRunResult).toHaveBeenCalledWith(runId, undefined, mockAuthContext);
    });

    it('cancel_run tool uses auth context passed at creation time', async () => {
      const runId = 'test-run-id';

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const cancelRunTool = registeredTools['cancel_run'];

      expect(cancelRunTool).toBeDefined();
      await cancelRunTool.handler({ runId });

      expect(workflowsService.cancelRun).toHaveBeenCalledWith(runId, undefined, mockAuthContext);
    });

    it('component tools do not require auth context', async () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const listComponentsTool = registeredTools['list_components'];
      const getComponentTool = registeredTools['get_component'];

      expect(listComponentsTool).toBeDefined();
      expect(getComponentTool).toBeDefined();

      const listResult = await listComponentsTool.handler({});
      expect(listResult).toBeDefined();

      const getResult = await getComponentTool.handler({
        componentId: 'core.workflow.entrypoint',
      });
      expect(getResult).toBeDefined();
    });

    describe('API key permission gating', () => {
      const restrictedAuth: AuthContext = {
        userId: 'api-key-id',
        organizationId: 'test-org-id',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'api-key',
        apiKeyPermissions: {
          workflows: { run: false, list: true, read: true },
          runs: { read: true, cancel: false },
        },
      };

      it('allows list_workflows when workflows.list is true', async () => {
        const server = service.createServer(restrictedAuth);
        const tools = getRegisteredTools(server);
        const result = (await tools['list_workflows'].handler({})) as { isError?: boolean };
        expect(result.isError).toBeUndefined();
      });

      it('denies run_workflow when workflows.run is false', async () => {
        const server = service.createServer(restrictedAuth);
        const tools = getRegisteredTools(server);
        const result = (await tools['run_workflow'].handler({
          workflowId: '11111111-1111-4111-8111-111111111111',
        })) as { isError?: boolean; content: { text: string }[] };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('workflows.run');
      });

      it('denies cancel_run when runs.cancel is false', async () => {
        const server = service.createServer(restrictedAuth);
        const tools = getRegisteredTools(server);
        const result = (await tools['cancel_run'].handler({
          runId: 'test-run-id',
        })) as { isError?: boolean; content: { text: string }[] };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('runs.cancel');
      });

      it('allows get_run_status when runs.read is true', async () => {
        const server = service.createServer(restrictedAuth);
        const tools = getRegisteredTools(server);
        const result = (await tools['get_run_status'].handler({
          runId: 'test-run-id',
        })) as { isError?: boolean };
        expect(result.isError).toBeUndefined();
      });

      it('allows all tools when no apiKeyPermissions (non-API-key auth)', async () => {
        const server = service.createServer(mockAuthContext); // no apiKeyPermissions
        const tools = getRegisteredTools(server);

        // All workflow/run tools should work without permission errors
        const listResult = (await tools['list_workflows'].handler({})) as { isError?: boolean };
        expect(listResult.isError).toBeUndefined();

        const runResult = (await tools['run_workflow'].handler({
          workflowId: '11111111-1111-4111-8111-111111111111',
        })) as { isError?: boolean };
        expect(runResult.isError).toBeUndefined();

        const cancelResult = (await tools['cancel_run'].handler({
          runId: 'test-run-id',
        })) as { isError?: boolean };
        expect(cancelResult.isError).toBeUndefined();
      });

      it('component tools are always allowed regardless of permissions', async () => {
        const noPermsAuth: AuthContext = {
          ...restrictedAuth,
          apiKeyPermissions: {
            workflows: { run: false, list: false, read: false },
            runs: { read: false, cancel: false },
          },
        };
        const server = service.createServer(noPermsAuth);
        const tools = getRegisteredTools(server);

        const listResult = (await tools['list_components'].handler({})) as { isError?: boolean };
        expect(listResult.isError).toBeUndefined();

        const getResult = (await tools['get_component'].handler({
          componentId: 'core.workflow.entrypoint',
        })) as { isError?: boolean };
        expect(getResult.isError).toBeUndefined();
      });

      it('denies all 7 gated tools when all permissions are false', async () => {
        const noPermsAuth: AuthContext = {
          ...restrictedAuth,
          apiKeyPermissions: {
            workflows: { run: false, list: false, read: false },
            runs: { read: false, cancel: false },
          },
        };
        const server = service.createServer(noPermsAuth);
        const tools = getRegisteredTools(server);

        const gatedTools = [
          'list_workflows',
          'get_workflow',
          'run_workflow',
          'list_runs',
          'get_run_status',
          'get_run_result',
          'cancel_run',
        ];

        for (const toolName of gatedTools) {
          const result = (await tools[toolName].handler({
            workflowId: '11111111-1111-4111-8111-111111111111',
            runId: 'test-run-id',
          })) as { isError?: boolean };
          expect(result.isError).toBe(true);
        }
      });
    });

    it('each server instance has isolated auth context', async () => {
      const authContext1: AuthContext = {
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'test',
      };

      const authContext2: AuthContext = {
        userId: 'user-2',
        organizationId: 'org-2',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'test',
      };

      const server1 = service.createServer(authContext1);
      const server2 = service.createServer(authContext2);

      const registeredTools1 = getRegisteredTools(server1);
      const registeredTools2 = getRegisteredTools(server2);

      const listWorkflowsTool1 = registeredTools1['list_workflows'];
      const listWorkflowsTool2 = registeredTools2['list_workflows'];

      expect(listWorkflowsTool1).toBeDefined();
      expect(listWorkflowsTool2).toBeDefined();

      await listWorkflowsTool1.handler({});
      await listWorkflowsTool2.handler({});

      expect(workflowsService.list).toHaveBeenCalledTimes(2);
      expect(workflowsService.list).toHaveBeenNthCalledWith(1, authContext1);
      expect(workflowsService.list).toHaveBeenNthCalledWith(2, authContext2);
    });
  });
});
