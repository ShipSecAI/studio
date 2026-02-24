import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExecutionStatus } from '@shipsec/shared';
import type { AuthContext } from '../../auth/types';
import type { WorkflowRunSummary } from '../../workflows/workflows.service';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

export function registerRunTools(server: McpServer, auth: AuthContext, deps: StudioMcpDeps): void {
  const { workflowsService } = deps;

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
}
