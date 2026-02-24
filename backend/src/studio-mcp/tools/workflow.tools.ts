import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../../auth/types';
import {
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  WorkflowViewportSchema,
  type ServiceWorkflowResponse,
} from '../../workflows/dto/workflow-graph.dto';
import { checkPermission, errorResult, jsonResult, type StudioMcpDeps } from './types';

const logger = new Logger('WorkflowTools');

export function registerWorkflowTools(
  server: McpServer,
  auth: AuthContext,
  deps: StudioMcpDeps,
): void {
  const { workflowsService } = deps;

  server.registerTool(
    'list_workflows',
    {
      description:
        'List all workflows in the organization. Returns id, name, description, and version info.',
    },
    async () => {
      const gate = checkPermission(auth, 'workflows.list');
      if (!gate.allowed) return gate.error;
      try {
        const workflows = await workflowsService.list(auth);
        const summary = workflows.map((w: ServiceWorkflowResponse) => ({
          id: w.id,
          name: w.name,
          description: w.description ?? null,
          currentVersion: w.currentVersion,
          currentVersionId: w.currentVersionId,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        }));
        return jsonResult(summary);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_workflow',
    {
      description:
        'Get detailed information about a specific workflow, including its graph (nodes, edges) and runtime input definitions.',
      inputSchema: { workflowId: z.string().uuid() },
    },
    async (args: { workflowId: string }) => {
      const gate = checkPermission(auth, 'workflows.read');
      if (!gate.allowed) return gate.error;
      try {
        const workflow = await workflowsService.findById(args.workflowId, auth);
        return jsonResult(workflow);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_workflow',
    {
      description:
        'Create a new workflow. Provide a name, optional description, and the graph definition (nodes and edges).',
      inputSchema: {
        name: z.string().describe('Name of the workflow'),
        description: z.string().optional().describe('Optional description of the workflow'),
        nodes: z
          .array(WorkflowNodeSchema)
          .min(1)
          .describe(
            'Array of workflow nodes. Each node needs id, type (component ID), position {x, y}, and data {label, config}',
          ),
        edges: z
          .array(WorkflowEdgeSchema)
          .describe(
            'Array of edges connecting nodes. Each edge needs id, source, target, and optionally sourceHandle/targetHandle for specific ports',
          ),
        viewport: WorkflowViewportSchema.optional().describe(
          'Optional viewport position {x, y, zoom}',
        ),
      },
    },
    async (args: {
      name: string;
      description?: string;
      nodes: z.infer<typeof WorkflowNodeSchema>[];
      edges: z.infer<typeof WorkflowEdgeSchema>[];
      viewport?: z.infer<typeof WorkflowViewportSchema>;
    }) => {
      const gate = checkPermission(auth, 'workflows.create');
      if (!gate.allowed) return gate.error;
      try {
        const graph = {
          name: args.name,
          description: args.description,
          nodes: args.nodes,
          edges: args.edges,
          viewport: args.viewport ?? { x: 0, y: 0, zoom: 1 },
        };
        const result = await workflowsService.create(graph, auth);
        return jsonResult({
          id: result.id,
          name: result.name,
          description: result.description ?? null,
          currentVersion: result.currentVersion,
          currentVersionId: result.currentVersionId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_workflow',
    {
      description:
        'Update an existing workflow graph (nodes and edges). This creates a new workflow version.',
      inputSchema: {
        workflowId: z.string().uuid().describe('ID of the workflow to update'),
        name: z.string().describe('Name of the workflow'),
        description: z.string().optional().describe('Optional description'),
        nodes: z.array(WorkflowNodeSchema).min(1).describe('Full array of workflow nodes'),
        edges: z.array(WorkflowEdgeSchema).describe('Full array of edges'),
        viewport: WorkflowViewportSchema.optional().describe('Optional viewport position'),
      },
    },
    async (args: {
      workflowId: string;
      name: string;
      description?: string;
      nodes: z.infer<typeof WorkflowNodeSchema>[];
      edges: z.infer<typeof WorkflowEdgeSchema>[];
      viewport?: z.infer<typeof WorkflowViewportSchema>;
    }) => {
      const gate = checkPermission(auth, 'workflows.update');
      if (!gate.allowed) return gate.error;
      try {
        const graph = {
          name: args.name,
          description: args.description,
          nodes: args.nodes,
          edges: args.edges,
          viewport: args.viewport ?? { x: 0, y: 0, zoom: 1 },
        };
        const result = await workflowsService.update(args.workflowId, graph, auth);
        return jsonResult({
          id: result.id,
          name: result.name,
          description: result.description ?? null,
          currentVersion: result.currentVersion,
          currentVersionId: result.currentVersionId,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'update_workflow_metadata',
    {
      description: 'Update only the name and/or description of a workflow.',
      inputSchema: {
        workflowId: z.string().uuid().describe('ID of the workflow to update'),
        name: z.string().describe('New name for the workflow'),
        description: z
          .string()
          .optional()
          .nullable()
          .describe('New description (or null to clear)'),
      },
    },
    async (args: { workflowId: string; name: string; description?: string | null }) => {
      const gate = checkPermission(auth, 'workflows.update');
      if (!gate.allowed) return gate.error;
      try {
        const result = await workflowsService.updateMetadata(
          args.workflowId,
          { name: args.name, description: args.description ?? null },
          auth,
        );
        return jsonResult({
          id: result.id,
          name: result.name,
          description: result.description ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'delete_workflow',
    {
      description: 'Permanently delete a workflow and all its versions.',
      inputSchema: {
        workflowId: z.string().uuid().describe('ID of the workflow to delete'),
      },
    },
    async (args: { workflowId: string }) => {
      const gate = checkPermission(auth, 'workflows.delete');
      if (!gate.allowed) return gate.error;
      try {
        await workflowsService.delete(args.workflowId, auth);
        return jsonResult({ deleted: true, workflowId: args.workflowId });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const runWorkflowSchema = {
    workflowId: z.string().uuid(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    versionId: z.string().uuid().optional(),
  };

  server.experimental.tasks.registerToolTask(
    'run_workflow',
    {
      description:
        'Start a workflow execution as a background task. The task handle can be monitored for status updates, and finally retrieved for the workflow result. Also supports legacy polling via get_run_status.',
      inputSchema: runWorkflowSchema,
      execution: { taskSupport: 'optional' },
    },
    {
      createTask: async (args, extra) => {
        const gate = checkPermission(auth, 'workflows.run');
        if (!gate.allowed) throw new Error(gate.error.content[0].text);

        const task = await extra.taskStore.createTask({ ttl: 12 * 60 * 60 * 1000 });

        const handle = await workflowsService.run(
          args.workflowId,
          {
            inputs: args.inputs ?? {},
            versionId: args.versionId,
          },
          auth,
          {
            trigger: {
              type: 'api',
              sourceId: auth.userId ?? 'api-key',
              label: 'Studio MCP Task',
            },
          },
        );

        monitorWorkflowRun(
          handle.runId,
          handle.temporalRunId,
          task.taskId,
          extra.taskStore,
          workflowsService,
          auth,
        ).catch((err) => {
          logger.error(`Error monitoring workflow run task for run ${handle.runId}: ${err}`);
        });

        return { task };
      },
      getTask: async (args, extra) => {
        const gate = checkPermission(auth, 'runs.read');
        if (!gate.allowed) throw new Error(gate.error.content[0].text);
        const task = await extra.taskStore.getTask(extra.taskId);
        if (!task) {
          throw new Error(`Task ${extra.taskId} not found`);
        }
        return task;
      },
      getTaskResult: async (args, extra) => {
        const gate = checkPermission(auth, 'runs.read');
        if (!gate.allowed) throw new Error(gate.error.content[0].text);
        const result = await extra.taskStore.getTaskResult(extra.taskId);
        return result as any;
      },
    },
  );
}

async function monitorWorkflowRun(
  runId: string,
  temporalRunId: string | undefined,
  taskId: string,
  taskStore: any,
  workflowsService: StudioMcpDeps['workflowsService'],
  auth: AuthContext,
): Promise<void> {
  const isTerminal = (status: string) =>
    ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'].includes(status);

  const mapStatus = (status: string): 'working' | 'completed' | 'cancelled' | 'failed' => {
    switch (status) {
      case 'RUNNING':
      case 'QUEUED':
      case 'AWAITING_INPUT':
        return 'working';
      case 'COMPLETED':
        return 'completed';
      case 'CANCELLED':
      case 'TERMINATED':
      case 'TIMED_OUT':
        return 'cancelled';
      case 'FAILED':
        return 'failed';
      default:
        return 'working';
    }
  };

  while (true) {
    try {
      const runStatusPayload = await workflowsService.getRunStatus(runId, temporalRunId, auth);
      const taskState = mapStatus(runStatusPayload.status);

      if (isTerminal(runStatusPayload.status)) {
        // For terminal states, storeTaskResult sets the status itself.
        // Do NOT call updateTaskStatus first — it would move the task into a terminal
        // state and then storeTaskResult would refuse to update it again.
        let resultData: any;
        if (taskState === 'completed') {
          try {
            resultData = await workflowsService.getRunResult(runId, temporalRunId, auth);
          } catch (err) {
            resultData = { error: String(err) };
          }
        } else {
          resultData = runStatusPayload.failure || { reason: runStatusPayload.status };
        }

        const resultPayload = {
          content: [{ type: 'text', text: JSON.stringify(resultData, null, 2) }],
        };

        const storeStatus = taskState === 'completed' ? 'completed' : 'failed';
        await taskStore.storeTaskResult(taskId, storeStatus, resultPayload);
        break;
      }

      // Non-terminal: just update status and keep polling
      await taskStore.updateTaskStatus(taskId, taskState, runStatusPayload.status);
      await new Promise((res) => setTimeout(res, 2000));
    } catch (err) {
      logger.error(`Error monitoring task ${taskId} (run: ${runId}): ${err}`);
      try {
        // storeTaskResult sets the terminal status; don't call updateTaskStatus first
        await taskStore.storeTaskResult(taskId, 'failed', {
          content: [{ type: 'text', text: `Failed to monitor workflow run: ${String(err)}` }],
          isError: true,
        });
      } catch (_storeErr) {
        // Ignore — task may already be in a terminal state
      }
      break;
    }
  }
}
