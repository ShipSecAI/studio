import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Ensure all worker components are registered before accessing the registry
import '@shipsec/studio-worker/components';
import {
  componentRegistry,
  extractPorts,
  isAgentCallable,
  getToolSchema,
  type CachedComponentMetadata,
} from '@shipsec/component-sdk';
import type { ExecutionStatus } from '@shipsec/shared';
import { categorizeComponent } from '../components/utils/categorization';
import { WorkflowsService, type WorkflowRunSummary } from '../workflows/workflows.service';
import type { ServiceWorkflowResponse } from '../workflows/dto/workflow-graph.dto';
import {
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  WorkflowViewportSchema,
} from '../workflows/dto/workflow-graph.dto';
import type { AuthContext, ApiKeyPermissions } from '../auth/types';

type PermissionPath =
  | 'workflows.list'
  | 'workflows.read'
  | 'workflows.create'
  | 'workflows.update'
  | 'workflows.delete'
  | 'workflows.run'
  | 'runs.read'
  | 'runs.cancel';

export interface StudioToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  execute: (args: Record<string, any>) => Promise<unknown>;
}

@Injectable()
export class StudioMcpService {
  private readonly logger = new Logger(StudioMcpService.name);

  constructor(private readonly workflowsService: WorkflowsService) {}

  /**
   * Require that the caller's API key permits the given action.
   * Throws if the permission is denied.
   */
  private requirePermission(auth: AuthContext, permission: PermissionPath): void {
    const perms = auth.apiKeyPermissions;
    if (!perms) return; // non-API-key auth → unrestricted

    const [scope, action] = permission.split('.') as [keyof ApiKeyPermissions, string];
    const scopePerms = perms[scope] as Record<string, boolean> | undefined;
    if (!scopePerms || !scopePerms[action]) {
      throw new Error(`Permission denied: API key lacks '${permission}' permission.`);
    }
  }

  /**
   * Returns the canonical set of Studio tool definitions, scoped to the given auth context.
   * Used by both the MCP server (for external agents) and the chat agent (for internal use).
   */
  getToolDefinitions(auth: AuthContext): StudioToolDefinition[] {
    return [
      // -- Workflow tools --
      {
        name: 'list_workflows',
        description:
          'List all workflows in the organization. Returns id, name, description, and version info.',
        inputSchema: {},
        execute: async () => {
          this.requirePermission(auth, 'workflows.list');
          const workflows = await this.workflowsService.list(auth);
          return workflows.map((w: ServiceWorkflowResponse) => ({
            id: w.id,
            name: w.name,
            description: w.description ?? null,
            currentVersion: w.currentVersion,
            currentVersionId: w.currentVersionId,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          }));
        },
      },
      {
        name: 'get_workflow',
        description:
          'Get detailed information about a specific workflow, including its graph (nodes, edges) and runtime input definitions.',
        inputSchema: { workflowId: z.string().uuid() },
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.read');
          return await this.workflowsService.findById(args.workflowId as string, auth);
        },
      },
      {
        name: 'run_workflow',
        description:
          'Start a workflow execution. Returns the run ID and initial status. Use get_run_status to poll for completion.',
        inputSchema: {
          workflowId: z.string().uuid(),
          inputs: z.record(z.string(), z.unknown()).optional(),
          versionId: z.string().uuid().optional(),
        },
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.run');
          const handle = await this.workflowsService.run(
            args.workflowId as string,
            {
              inputs: (args.inputs as Record<string, unknown>) ?? {},
              versionId: args.versionId as string | undefined,
            },
            auth,
            {
              trigger: {
                type: 'api',
                sourceId: auth.userId ?? 'api-key',
                label: 'Studio',
              },
            },
          );
          return {
            runId: handle.runId,
            workflowId: handle.workflowId,
            status: handle.status,
            workflowVersion: handle.workflowVersion,
          };
        },
      },

      {
        name: 'create_workflow',
        description:
          'Create a new workflow. Provide a name, optional description, and the graph definition (nodes and edges). Use list_components and get_component to discover available node types and their schemas before building the graph.',
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
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.create');
          const graph = {
            name: args.name as string,
            description: args.description as string | undefined,
            nodes: args.nodes as z.infer<typeof WorkflowNodeSchema>[],
            edges: args.edges as z.infer<typeof WorkflowEdgeSchema>[],
            viewport: (args.viewport as z.infer<typeof WorkflowViewportSchema>) ?? {
              x: 0,
              y: 0,
              zoom: 1,
            },
          };
          const result = await this.workflowsService.create(graph, auth);
          return {
            id: result.id,
            name: result.name,
            description: result.description ?? null,
            currentVersion: result.currentVersion,
            currentVersionId: result.currentVersionId,
          };
        },
      },
      {
        name: 'update_workflow',
        description:
          'Update an existing workflow graph (nodes & edges). This creates a new version. Use get_workflow first to retrieve the current graph, modify it, then pass the full updated graph.',
        inputSchema: {
          workflowId: z.string().uuid().describe('ID of the workflow to update'),
          name: z.string().describe('Name of the workflow'),
          description: z.string().optional().describe('Optional description'),
          nodes: z.array(WorkflowNodeSchema).min(1).describe('Full array of workflow nodes'),
          edges: z.array(WorkflowEdgeSchema).describe('Full array of edges'),
          viewport: WorkflowViewportSchema.optional().describe('Optional viewport position'),
        },
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.update');
          const graph = {
            name: args.name as string,
            description: args.description as string | undefined,
            nodes: args.nodes as z.infer<typeof WorkflowNodeSchema>[],
            edges: args.edges as z.infer<typeof WorkflowEdgeSchema>[],
            viewport: (args.viewport as z.infer<typeof WorkflowViewportSchema>) ?? {
              x: 0,
              y: 0,
              zoom: 1,
            },
          };
          const result = await this.workflowsService.update(args.workflowId as string, graph, auth);
          return {
            id: result.id,
            name: result.name,
            description: result.description ?? null,
            currentVersion: result.currentVersion,
            currentVersionId: result.currentVersionId,
          };
        },
      },
      {
        name: 'update_workflow_metadata',
        description:
          'Update only the name and/or description of a workflow without changing its graph.',
        inputSchema: {
          workflowId: z.string().uuid().describe('ID of the workflow to update'),
          name: z.string().describe('New name for the workflow'),
          description: z
            .string()
            .optional()
            .nullable()
            .describe('New description (or null to clear)'),
        },
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.update');
          const result = await this.workflowsService.updateMetadata(
            args.workflowId as string,
            { name: args.name as string, description: (args.description as string | null) ?? null },
            auth,
          );
          return {
            id: result.id,
            name: result.name,
            description: result.description ?? null,
          };
        },
      },
      {
        name: 'delete_workflow',
        description:
          'Permanently delete a workflow and all its versions. This action cannot be undone.',
        inputSchema: {
          workflowId: z.string().uuid().describe('ID of the workflow to delete'),
        },
        execute: async (args) => {
          this.requirePermission(auth, 'workflows.delete');
          await this.workflowsService.delete(args.workflowId as string, auth);
          return { deleted: true, workflowId: args.workflowId };
        },
      },

      // -- Run tools --
      {
        name: 'list_runs',
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
        execute: async (args) => {
          this.requirePermission(auth, 'runs.read');
          const result = await this.workflowsService.listRuns(auth, {
            workflowId: args.workflowId as string | undefined,
            status: args.status as ExecutionStatus | undefined,
            limit: (args.limit as number) ?? 20,
          });
          return result.runs.map((r: WorkflowRunSummary) => ({
            id: r.id,
            workflowId: r.workflowId,
            workflowName: r.workflowName,
            status: r.status,
            startTime: r.startTime,
            endTime: r.endTime,
            duration: r.duration,
            triggerType: r.triggerType,
          }));
        },
      },
      {
        name: 'get_run_status',
        description:
          'Get the current status of a workflow run including progress, failures, and timing.',
        inputSchema: { runId: z.string() },
        execute: async (args) => {
          this.requirePermission(auth, 'runs.read');
          return await this.workflowsService.getRunStatus(args.runId as string, undefined, auth);
        },
      },
      {
        name: 'get_run_result',
        description: 'Get the final result/output of a completed workflow run.',
        inputSchema: { runId: z.string() },
        execute: async (args) => {
          this.requirePermission(auth, 'runs.read');
          return await this.workflowsService.getRunResult(args.runId as string, undefined, auth);
        },
      },
      {
        name: 'cancel_run',
        description: 'Cancel a running workflow execution.',
        inputSchema: { runId: z.string() },
        execute: async (args) => {
          this.requirePermission(auth, 'runs.cancel');
          await this.workflowsService.cancelRun(args.runId as string, undefined, auth);
          return { cancelled: true, runId: args.runId };
        },
      },

      // -- Component tools --
      {
        name: 'list_components',
        description:
          'List all available workflow components (nodes) with their category, description, and whether they are agent-callable.',
        inputSchema: {},
        execute: async () => {
          const entries = componentRegistry.listMetadata();
          return entries.map((entry: CachedComponentMetadata) => {
            const def = entry.definition;
            const category = categorizeComponent(def);
            return {
              id: def.id,
              name: def.label,
              category,
              description: def.ui?.description ?? def.docs ?? '',
              runner: def.runner?.kind ?? 'inline',
              agentCallable: isAgentCallable(def),
              inputCount: (entry.inputs ?? []).length,
              outputCount: (entry.outputs ?? []).length,
            };
          });
        },
      },
      {
        name: 'get_component',
        description:
          'Get detailed information about a specific component, including its full input/output/parameter schemas.',
        inputSchema: { componentId: z.string() },
        execute: async (args) => {
          const entry = componentRegistry.getMetadata(args.componentId as string);
          if (!entry) {
            throw new Error(`Component "${args.componentId}" not found`);
          }
          const def = entry.definition;
          const category = categorizeComponent(def);
          return {
            id: def.id,
            name: def.label,
            category,
            description: def.ui?.description ?? def.docs ?? '',
            documentation: def.docs ?? null,
            runner: def.runner,
            inputs: entry.inputs ?? extractPorts(def.inputs),
            outputs: entry.outputs ?? extractPorts(def.outputs),
            parameters: entry.parameters ?? [],
            agentCallable: isAgentCallable(def),
            toolSchema: isAgentCallable(def) ? getToolSchema(def) : null,
          };
        },
      },
    ];
  }

  /**
   * Create an MCP server with all Studio tools registered, scoped to the given auth context.
   * Uses Streamable HTTP transport only (no legacy SSE).
   */
  createServer(auth: AuthContext): McpServer {
    const server = new McpServer({
      name: 'shipsec-studio',
      version: '1.0.0',
    });

    this.registerTools(server, auth);

    return server;
  }

  private registerTools(server: McpServer, auth: AuthContext): void {
    for (const def of this.getToolDefinitions(auth)) {
      const hasInputs = Object.keys(def.inputSchema).length > 0;
      server.registerTool(
        def.name,
        {
          description: def.description,
          ...(hasInputs ? { inputSchema: def.inputSchema } : {}),
        },
        async (args: Record<string, unknown>) => {
          try {
            const result = await def.execute(args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          } catch (error) {
            return this.errorResult(error);
          }
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private errorResult(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Studio MCP tool error: ${message}`);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}
