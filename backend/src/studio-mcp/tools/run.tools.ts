import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExecutionStatus } from '@shipsec/shared';
import type { AuthContext } from '../../auth/types';
import type { WorkflowRunSummary } from '../../workflows/workflows.service';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerRunTools(server: McpServer, auth: AuthContext, deps: StudioMcpDeps): void {
  const { workflowsService, traceService, nodeIOService, logStreamService } = deps;

  server.registerTool(
    'list_runs',
    {
      description: 'List recent workflow runs. Optionally filter by workflow or status.',
      inputSchema: {
        workflowId: z.string().uuid().optional(),
        status: z
          .enum([
            'RUNNING',
            'COMPLETED',
            'FAILED',
            'CANCELLED',
            'TERMINATED',
            'TIMED_OUT',
            'AWAITING_INPUT',
          ])
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async (args: { workflowId?: string; status?: ExecutionStatus; limit?: number }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      try {
        const result = await workflowsService.listRuns(auth, {
          workflowId: args.workflowId,
          status: args.status,
          limit: args.limit ?? 20,
        });
        const runs = result.runs.map((r: WorkflowRunSummary) => ({
          id: r.id,
          workflowId: r.workflowId,
          workflowName: r.workflowName,
          status: r.status,
          startTime: r.startTime,
          endTime: r.endTime,
          duration: r.duration,
          triggerType: r.triggerType,
        }));
        return jsonResult(runs);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_status',
    {
      description:
        'Get the current status of a workflow run including progress, failures, and timing.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      try {
        const status = await workflowsService.getRunStatus(args.runId, undefined, auth);
        return jsonResult(status);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_result',
    {
      description: 'Get the final result/output of a completed workflow run.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      try {
        const result = await workflowsService.getRunResult(args.runId, undefined, auth);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'cancel_run',
    {
      description: 'Cancel a running workflow execution.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.cancel');
      if (!gate.allowed) return gate.error;
      try {
        await workflowsService.cancelRun(args.runId, undefined, auth);
        return jsonResult({ cancelled: true, runId: args.runId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_config',
    {
      description: 'Get the original inputs and version metadata for a run.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      try {
        const config = await workflowsService.getRunConfig(args.runId, auth);
        return jsonResult(config);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_trace',
    {
      description:
        'Get trace events (node lifecycle: started, completed, failed, progress) for a run.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      if (!traceService) return errorResult(new Error('traceService is not available'));
      try {
        const result = await traceService.list(args.runId, auth);
        return jsonResult(result.events);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_run_node_io',
    {
      description: 'List all nodes in a run with their I/O summary (status, timing, data size).',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      if (!nodeIOService) return errorResult(new Error('nodeIOService is not available'));
      try {
        const summaries = await nodeIOService.listSummaries(
          args.runId,
          auth.organizationId ?? undefined,
        );
        return jsonResult(summaries);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_node_io',
    {
      description:
        'Get detailed inputs and outputs for a specific node in a run. Set full=true to fetch complete data from storage instead of the 1KB preview.',
      inputSchema: {
        runId: z.string(),
        nodeRef: z.string(),
        full: z.boolean().optional(),
      },
    },
    async (args: { runId: string; nodeRef: string; full?: boolean }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      if (!nodeIOService) return errorResult(new Error('nodeIOService is not available'));
      try {
        await workflowsService.ensureRunAccess(args.runId, auth);
        const io = await nodeIOService.getNodeIO(args.runId, args.nodeRef, args.full ?? false);
        return jsonResult(io);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_run_logs',
    {
      description:
        'Get structured log entries for a run with optional filtering by node, stream, level, and pagination.',
      inputSchema: {
        runId: z.string(),
        nodeRef: z.string().optional(),
        stream: z.enum(['stdout', 'stderr']).optional(),
        level: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        cursor: z.string().optional(),
      },
    },
    async (args: {
      runId: string;
      nodeRef?: string;
      stream?: 'stdout' | 'stderr';
      level?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      if (!logStreamService) return errorResult(new Error('logStreamService is not available'));
      try {
        const logs = await logStreamService.fetch(args.runId, auth, {
          nodeRef: args.nodeRef,
          stream: args.stream,
          level: args.level,
          limit: args.limit ?? 100,
          cursor: args.cursor,
        });
        return jsonResult(logs);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_child_runs',
    {
      description: 'List sub-workflow runs spawned by a parent run.',
      inputSchema: { runId: z.string() },
    },
    async (args: { runId: string }) => {
      const gate = checkPermission(auth, 'runs.read');
      if (!gate.allowed) return gate.error;
      try {
        const children = await workflowsService.listChildRuns(args.runId, auth);
        return jsonResult(children);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
