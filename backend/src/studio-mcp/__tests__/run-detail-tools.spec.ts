import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpService } from '../studio-mcp.service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';

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
  userId: 'restricted-user-id',
  organizationId: 'test-org-id',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'test',
  apiKeyPermissions: {
    workflows: { run: false, list: false, read: false },
    runs: { read: false, cancel: false },
    audit: { read: false },
  },
};

function makeWorkflowsService() {
  return {
    listRuns: jest.fn().mockResolvedValue({ runs: [] }),
    getRunStatus: jest.fn().mockResolvedValue({}),
    getRunResult: jest.fn().mockResolvedValue({}),
    cancelRun: jest.fn().mockResolvedValue(undefined),
    getRunConfig: jest.fn(),
    listChildRuns: jest.fn(),
    ensureRunAccess: jest.fn(),
    findById: jest.fn().mockResolvedValue(null),
    listWorkflows: jest.fn().mockResolvedValue({ workflows: [] }),
  } as any;
}

function makeTraceService() {
  return {
    list: jest.fn().mockResolvedValue({ events: [], cursor: undefined }),
  };
}

function makeNodeIOService() {
  return {
    listSummaries: jest.fn(),
    getNodeIO: jest.fn(),
  };
}

function makeLogStreamService() {
  return {
    fetch: jest.fn(),
  };
}

describe('Run Detail Tools', () => {
  let workflowsService: ReturnType<typeof makeWorkflowsService>;
  let traceService: ReturnType<typeof makeTraceService>;
  let nodeIOService: ReturnType<typeof makeNodeIOService>;
  let logStreamService: ReturnType<typeof makeLogStreamService>;
  let mcpService: StudioMcpService;
  let tools: RegisteredToolsMap;

  beforeEach(() => {
    workflowsService = makeWorkflowsService();
    traceService = makeTraceService();
    nodeIOService = makeNodeIOService();
    logStreamService = makeLogStreamService();

    mcpService = new StudioMcpService(
      workflowsService,
      undefined,
      nodeIOService as any,
      traceService as any,
      logStreamService as any,
    );

    const server = mcpService.createServer(mockAuth);
    tools = getRegisteredTools(server);
  });

  describe('get_run_config', () => {
    it('calls workflowsService.getRunConfig with runId and auth and returns result', async () => {
      const config = {
        runId: 'run-abc',
        inputs: { foo: 'bar' },
        workflowVersion: '2',
      };
      workflowsService.getRunConfig.mockResolvedValue(config);

      const result = await tools['get_run_config'].handler({ runId: 'run-abc' });

      expect(workflowsService.getRunConfig).toHaveBeenCalledWith('run-abc', mockAuth);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(config);
    });

    it('returns error result when getRunConfig throws', async () => {
      workflowsService.getRunConfig.mockRejectedValue(new Error('not found'));

      const result = await tools['get_run_config'].handler({ runId: 'run-missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: not found');
    });
  });

  describe('get_run_trace', () => {
    it('calls traceService.list and returns only events (not cursor)', async () => {
      const events = [
        { type: 'node.started', nodeRef: 'node-1', ts: '2024-01-01T00:00:00Z' },
        { type: 'node.completed', nodeRef: 'node-1', ts: '2024-01-01T00:00:05Z' },
      ];
      traceService.list.mockResolvedValue({ events, cursor: 'next-page-token' });

      const result = await tools['get_run_trace'].handler({ runId: 'run-abc' });

      expect(traceService.list).toHaveBeenCalledWith('run-abc', mockAuth);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(events);
      // Must not expose cursor in the result
      expect(result.content[0].text).not.toContain('next-page-token');
    });

    it('returns error result when traceService.list throws', async () => {
      traceService.list.mockRejectedValue(new Error('trace unavailable'));

      const result = await tools['get_run_trace'].handler({ runId: 'run-abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: trace unavailable');
    });

    it('returns error when traceService is not provided', async () => {
      const svcWithoutTrace = new StudioMcpService(
        workflowsService,
        undefined,
        nodeIOService as any,
        undefined, // no traceService
        logStreamService as any,
      );
      const server = svcWithoutTrace.createServer(mockAuth);
      const toolsNoTrace = getRegisteredTools(server);

      const result = await toolsNoTrace['get_run_trace'].handler({ runId: 'run-abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });
  });

  describe('list_run_node_io', () => {
    it('calls nodeIOService.listSummaries with runId and organizationId', async () => {
      const summaries = [
        { nodeRef: 'node-1', status: 'completed', inputSize: 100, outputSize: 200 },
      ];
      nodeIOService.listSummaries.mockResolvedValue(summaries);

      const result = await tools['list_run_node_io'].handler({ runId: 'run-abc' });

      expect(nodeIOService.listSummaries).toHaveBeenCalledWith('run-abc', 'test-org-id');
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(summaries);
    });

    it('returns error when nodeIOService is not provided', async () => {
      const svcWithoutNodeIO = new StudioMcpService(
        workflowsService,
        undefined,
        undefined, // no nodeIOService
        traceService as any,
        logStreamService as any,
      );
      const server = svcWithoutNodeIO.createServer(mockAuth);
      const toolsNoNodeIO = getRegisteredTools(server);

      const result = await toolsNoNodeIO['list_run_node_io'].handler({ runId: 'run-abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });
  });

  describe('get_node_io', () => {
    it('calls ensureRunAccess before getNodeIO (security check)', async () => {
      const callOrder: string[] = [];
      workflowsService.ensureRunAccess.mockImplementation(async () => {
        callOrder.push('ensureRunAccess');
      });
      nodeIOService.getNodeIO.mockImplementation(async () => {
        callOrder.push('getNodeIO');
        return { inputs: {}, outputs: {} };
      });

      const result = await tools['get_node_io'].handler({
        runId: 'run-abc',
        nodeRef: 'node-1',
      });

      expect(callOrder).toEqual(['ensureRunAccess', 'getNodeIO']);
      expect(workflowsService.ensureRunAccess).toHaveBeenCalledWith('run-abc', mockAuth);
      expect(nodeIOService.getNodeIO).toHaveBeenCalledWith('run-abc', 'node-1', false);
      expect(result.isError).toBeUndefined();
    });

    it('passes full=true to getNodeIO when requested', async () => {
      workflowsService.ensureRunAccess.mockResolvedValue(undefined);
      nodeIOService.getNodeIO.mockResolvedValue({ inputs: {}, outputs: {} });

      await tools['get_node_io'].handler({ runId: 'run-abc', nodeRef: 'node-1', full: true });

      expect(nodeIOService.getNodeIO).toHaveBeenCalledWith('run-abc', 'node-1', true);
    });

    it('returns error and does not call getNodeIO if ensureRunAccess throws (cross-org protection)', async () => {
      workflowsService.ensureRunAccess.mockRejectedValue(new Error('Access denied'));

      const result = await tools['get_node_io'].handler({
        runId: 'run-other-org',
        nodeRef: 'node-1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: Access denied');
      expect(nodeIOService.getNodeIO).not.toHaveBeenCalled();
    });

    it('returns error when nodeIOService is not provided', async () => {
      const svcWithoutNodeIO = new StudioMcpService(
        workflowsService,
        undefined,
        undefined,
        traceService as any,
        logStreamService as any,
      );
      const server = svcWithoutNodeIO.createServer(mockAuth);
      const toolsNoNodeIO = getRegisteredTools(server);

      const result = await toolsNoNodeIO['get_node_io'].handler({
        runId: 'run-abc',
        nodeRef: 'node-1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });
  });

  describe('get_run_logs', () => {
    it('calls logStreamService.fetch with runId, auth and options', async () => {
      const logs = { logs: [{ id: 'l1', message: 'hello', level: 'info' }], nextCursor: null };
      logStreamService.fetch.mockResolvedValue(logs);

      const result = await tools['get_run_logs'].handler({
        runId: 'run-abc',
        nodeRef: 'node-1',
        stream: 'stdout',
        level: 'info',
        limit: 50,
        cursor: 'tok',
      });

      expect(logStreamService.fetch).toHaveBeenCalledWith('run-abc', mockAuth, {
        nodeRef: 'node-1',
        stream: 'stdout',
        level: 'info',
        limit: 50,
        cursor: 'tok',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(logs);
    });

    it('uses default limit of 100 when not specified', async () => {
      logStreamService.fetch.mockResolvedValue({ logs: [] });

      await tools['get_run_logs'].handler({ runId: 'run-abc' });

      expect(logStreamService.fetch).toHaveBeenCalledWith(
        'run-abc',
        mockAuth,
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('returns error when logStreamService is not provided', async () => {
      const svcWithoutLogs = new StudioMcpService(
        workflowsService,
        undefined,
        nodeIOService as any,
        traceService as any,
        undefined, // no logStreamService
      );
      const server = svcWithoutLogs.createServer(mockAuth);
      const toolsNoLogs = getRegisteredTools(server);

      const result = await toolsNoLogs['get_run_logs'].handler({ runId: 'run-abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error:');
    });

    it('returns error result when logStreamService.fetch throws', async () => {
      logStreamService.fetch.mockRejectedValue(new Error('Loki unavailable'));

      const result = await tools['get_run_logs'].handler({ runId: 'run-abc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: Loki unavailable');
    });
  });

  describe('list_child_runs', () => {
    it('calls workflowsService.listChildRuns with runId and auth and returns result', async () => {
      const children = [
        { id: 'child-run-1', workflowId: 'wf-1', status: 'COMPLETED' },
        { id: 'child-run-2', workflowId: 'wf-2', status: 'RUNNING' },
      ];
      workflowsService.listChildRuns.mockResolvedValue(children);

      const result = await tools['list_child_runs'].handler({ runId: 'run-abc' });

      expect(workflowsService.listChildRuns).toHaveBeenCalledWith('run-abc', mockAuth);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(children);
    });

    it('returns error result when listChildRuns throws', async () => {
      workflowsService.listChildRuns.mockRejectedValue(new Error('run not found'));

      const result = await tools['list_child_runs'].handler({ runId: 'run-missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: run not found');
    });
  });

  describe('Permission checks (restrictedAuth with runs.read = false)', () => {
    let restrictedTools: RegisteredToolsMap;

    beforeEach(() => {
      const svc = new StudioMcpService(
        workflowsService,
        undefined,
        nodeIOService as any,
        traceService as any,
        logStreamService as any,
      );
      const server = svc.createServer(restrictedAuth);
      restrictedTools = getRegisteredTools(server);
    });

    it('get_run_config returns permission denied', async () => {
      const result = await restrictedTools['get_run_config'].handler({ runId: 'run-abc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(workflowsService.getRunConfig).not.toHaveBeenCalled();
    });

    it('get_run_trace returns permission denied', async () => {
      const result = await restrictedTools['get_run_trace'].handler({ runId: 'run-abc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(traceService.list).not.toHaveBeenCalled();
    });

    it('list_run_node_io returns permission denied', async () => {
      const result = await restrictedTools['list_run_node_io'].handler({ runId: 'run-abc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(nodeIOService.listSummaries).not.toHaveBeenCalled();
    });

    it('get_node_io returns permission denied', async () => {
      const result = await restrictedTools['get_node_io'].handler({
        runId: 'run-abc',
        nodeRef: 'node-1',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(workflowsService.ensureRunAccess).not.toHaveBeenCalled();
      expect(nodeIOService.getNodeIO).not.toHaveBeenCalled();
    });

    it('get_run_logs returns permission denied', async () => {
      const result = await restrictedTools['get_run_logs'].handler({ runId: 'run-abc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(logStreamService.fetch).not.toHaveBeenCalled();
    });

    it('list_child_runs returns permission denied', async () => {
      const result = await restrictedTools['list_child_runs'].handler({ runId: 'run-abc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Permission denied');
      expect(workflowsService.listChildRuns).not.toHaveBeenCalled();
    });
  });
});
