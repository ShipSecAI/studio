import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpService } from '../studio-mcp.service';
import { monitorWorkflowRun } from '../tools/workflow.tools';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import type { WorkflowsService } from '../../workflows/workflows.service';

// Helper to access private _registeredTools and experimental tasks on McpServer (plain object at runtime)
type RegisteredToolsMap = Record<string, any>;

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
      create: jest.fn().mockResolvedValue({
        id: 'created-workflow-id',
        name: 'Created Workflow',
        description: null,
        currentVersion: 1,
        currentVersionId: 'created-version-id',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'updated-workflow-id',
        name: 'Updated Workflow',
        description: 'Updated description',
        currentVersion: 2,
        currentVersionId: 'updated-version-id',
      }),
      updateMetadata: jest.fn().mockResolvedValue({
        id: 'updated-workflow-id',
        name: 'Updated Workflow',
        description: 'Updated description',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
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

    it('registers all expected tools and tasks', () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);

      expect(registeredTools).toBeDefined();

      const toolNames = Object.keys(registeredTools).sort();
      expect(toolNames).toEqual([
        'cancel_run',
        'create_secret',
        'create_workflow',
        'delete_secret',
        'delete_workflow',
        'get_component',
        'get_human_input',
        'get_node_io',
        'get_run_config',
        'get_run_logs',
        'get_run_result',
        'get_run_status',
        'get_run_trace',
        'get_workflow',
        'list_artifacts',
        'list_child_runs',
        'list_components',
        'list_human_inputs',
        'list_run_artifacts',
        'list_run_node_io',
        'list_runs',
        'list_secrets',
        'list_workflows',
        'resolve_human_input',
        'rotate_secret',
        'run_workflow',
        'update_secret',
        'update_workflow',
        'update_workflow_metadata',
        'view_artifact',
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

    it('create_workflow tool uses auth context passed at creation time', async () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const createWorkflowTool = registeredTools['create_workflow'];

      expect(createWorkflowTool).toBeDefined();
      await createWorkflowTool.handler({
        name: 'New Workflow',
        nodes: [
          {
            id: 'entry-1',
            type: 'core.workflow.entrypoint',
            position: { x: 10, y: 20 },
            data: { label: 'Start', config: {} },
          },
        ],
        edges: [],
      });

      expect(workflowsService.create).toHaveBeenCalledWith(
        {
          name: 'New Workflow',
          description: undefined,
          nodes: [
            {
              id: 'entry-1',
              type: 'core.workflow.entrypoint',
              position: { x: 10, y: 20 },
              data: { label: 'Start', config: {} },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        mockAuthContext,
      );
    });

    it('delete_workflow tool uses auth context passed at creation time', async () => {
      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const deleteWorkflowTool = registeredTools['delete_workflow'];

      expect(deleteWorkflowTool).toBeDefined();
      await deleteWorkflowTool.handler({ workflowId: '11111111-1111-4111-8111-111111111111' });

      expect(workflowsService.delete).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        mockAuthContext,
      );
    });

    it('run_workflow task uses auth context passed at creation time', async () => {
      const workflowId = '11111111-1111-4111-8111-111111111111';
      const inputs = { key: 'value' };

      const server = service.createServer(mockAuthContext);
      const registeredTools = getRegisteredTools(server);
      const runWorkflowTask = registeredTools['run_workflow'];

      expect(runWorkflowTask).toBeDefined();

      // Need to mock the extra params for the experimental tasks
      const mockExtra = {
        taskStore: {
          createTask: jest.fn().mockResolvedValue({ taskId: 'mockTaskId', status: 'working' }),
          getTask: jest.fn().mockResolvedValue({ taskId: 'mockTaskId', status: 'working' }),
          updateTaskStatus: jest.fn().mockResolvedValue(true),
          storeTaskResult: jest.fn().mockResolvedValue(true),
        },
      };

      await runWorkflowTask.handler.createTask({ workflowId, inputs }, mockExtra);

      expect(workflowsService.run).toHaveBeenCalledWith(
        workflowId,
        { inputs, versionId: undefined },
        mockAuthContext,
        {
          trigger: {
            type: 'api',
            sourceId: mockAuthContext.userId,
            label: 'Studio MCP Task',
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
          audit: { read: false },
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
        const tasks = getRegisteredTools(server);

        let errorThrown = false;
        try {
          await tasks['run_workflow'].handler.createTask(
            {
              workflowId: '11111111-1111-4111-8111-111111111111',
            },
            {} as any,
          );
        } catch (_e: any) {
          errorThrown = true;
          expect(_e.message).toContain('workflows.run');
        }
        expect(errorThrown).toBe(true);
      });

      it('denies create_workflow when workflows.create is missing', async () => {
        const server = service.createServer(restrictedAuth);
        const tools = getRegisteredTools(server);
        const result = (await tools['create_workflow'].handler({
          name: 'Denied Create',
          nodes: [],
          edges: [],
        })) as { isError?: boolean; content: { text: string }[] };
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('workflows.create');
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
        const tasks = getRegisteredTools(server);

        // All workflow/run tools should work without permission errors
        const listResult = (await tools['list_workflows'].handler({})) as { isError?: boolean };
        expect(listResult.isError).toBeUndefined();

        const mockExtra = {
          taskStore: {
            createTask: jest.fn().mockResolvedValue({ taskId: 'mock', status: 'working' }),
            getTask: jest.fn().mockResolvedValue({ taskId: 'mock', status: 'working' }),
            updateTaskStatus: jest.fn().mockResolvedValue(true),
            storeTaskResult: jest.fn().mockResolvedValue(true),
          },
        };

        const runResult = await tasks['run_workflow'].handler.createTask(
          {
            workflowId: '11111111-1111-4111-8111-111111111111',
          },
          mockExtra,
        );
        expect(runResult.task.taskId).toEqual('mock');

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
            audit: { read: false },
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

      it('denies all gated non-task tools when all permissions are false', async () => {
        const noPermsAuth: AuthContext = {
          ...restrictedAuth,
          apiKeyPermissions: {
            workflows: { run: false, list: false, read: false },
            runs: { read: false, cancel: false },
            audit: { read: false },
          },
        };
        const server = service.createServer(noPermsAuth);
        const tools = getRegisteredTools(server);
        const tasks = getRegisteredTools(server);

        const gatedTools = [
          'list_workflows',
          'get_workflow',
          'create_workflow',
          'update_workflow',
          'update_workflow_metadata',
          'delete_workflow',
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

        // Test run_workflow separately since it's a task now
        let errorThrown = false;
        try {
          await tasks['run_workflow'].handler.createTask(
            {
              workflowId: '11111111-1111-4111-8111-111111111111',
            },
            {} as any,
          );
        } catch (_e: any) {
          errorThrown = true;
        }
        expect(errorThrown).toBe(true);
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

  describe('monitorWorkflowRun', () => {
    it('polls status and saves result on completion', async () => {
      const mockTaskStore = {
        updateTaskStatus: jest.fn().mockResolvedValue(true),
        storeTaskResult: jest.fn().mockResolvedValue(true),
      };

      const taskId = 'test-task-id';
      const runId = 'test-run-id';

      // Mock getRunStatus to return RUNNING first, then COMPLETED
      let callCount = 0;
      (workflowsService.getRunStatus as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          status: callCount === 1 ? 'RUNNING' : 'COMPLETED',
        });
      });

      (workflowsService.getRunResult as jest.Mock).mockResolvedValue({
        output: 'test-output',
      });

      // We overwrite the 2000ms timeout temporarily for the test to avoid slow running loop
      const originalSetTimeout = global.setTimeout;
      (global as any).setTimeout = (fn: any) => originalSetTimeout(fn, 1);

      try {
        await monitorWorkflowRun(
          runId,
          undefined,
          taskId,
          mockTaskStore,
          workflowsService,
          mockAuthContext,
        );
      } finally {
        global.setTimeout = originalSetTimeout as any;
      }

      // updateTaskStatus is only called for non-terminal states (RUNNING → working).
      // For COMPLETED, storeTaskResult handles the terminal transition directly.
      expect(mockTaskStore.updateTaskStatus).toHaveBeenCalledTimes(1);
      expect(mockTaskStore.updateTaskStatus).toHaveBeenCalledWith(taskId, 'working', 'RUNNING');
      expect(mockTaskStore.updateTaskStatus).not.toHaveBeenCalledWith(
        taskId,
        'completed',
        'COMPLETED',
      );
      expect(workflowsService.getRunResult).toHaveBeenCalledWith(runId, undefined, mockAuthContext);
      expect(mockTaskStore.storeTaskResult).toHaveBeenCalledWith(taskId, 'completed', {
        content: [{ type: 'text', text: JSON.stringify({ output: 'test-output' }, null, 2) }],
      });
    });

    it('handles failures by storing the failure reason', async () => {
      const mockTaskStore = {
        updateTaskStatus: jest.fn().mockResolvedValue(true),
        storeTaskResult: jest.fn().mockResolvedValue(true),
      };

      const taskId = 'test-task-id';
      const runId = 'test-run-id';

      (workflowsService.getRunStatus as jest.Mock).mockResolvedValue({
        status: 'FAILED',
        failure: { message: 'boom' },
      });

      await monitorWorkflowRun(
        runId,
        undefined,
        taskId,
        mockTaskStore,
        workflowsService,
        mockAuthContext,
      );

      // updateTaskStatus is NOT called for terminal states — storeTaskResult handles it.
      expect(mockTaskStore.updateTaskStatus).not.toHaveBeenCalled();
      expect(mockTaskStore.storeTaskResult).toHaveBeenCalledWith(taskId, 'failed', {
        content: [{ type: 'text', text: JSON.stringify({ message: 'boom' }, null, 2) }],
      });
    });
  });
});
