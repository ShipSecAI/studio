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
import type { AuthContext, ApiKeyPermissions } from '../auth/types';

type PermissionPath =
  | 'workflows.list'
  | 'workflows.read'
  | 'workflows.run'
  | 'runs.read'
  | 'runs.cancel';

@Injectable()
export class StudioMcpService {
  private readonly logger = new Logger(StudioMcpService.name);

  constructor(private readonly workflowsService: WorkflowsService) {}

  /**
   * Check whether the caller's API key permits the given action.
   * Non-API-key callers (e.g. internal service tokens) are always allowed.
   */
  private checkPermission(
    auth: AuthContext,
    permission: PermissionPath,
  ):
    | { allowed: true }
    | { allowed: false; error: { content: { type: 'text'; text: string }[]; isError: true } } {
    const perms = auth.apiKeyPermissions;
    if (!perms) return { allowed: true }; // non-API-key auth → unrestricted

    const [scope, action] = permission.split('.') as [keyof ApiKeyPermissions, string];
    const scopePerms = perms[scope] as Record<string, boolean> | undefined;
    if (!scopePerms || !scopePerms[action]) {
      return {
        allowed: false,
        error: {
          content: [
            {
              type: 'text' as const,
              text: `Permission denied: API key lacks '${permission}' permission.`,
            },
          ],
          isError: true,
        },
      };
    }
    return { allowed: true };
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
    this.registerWorkflowTools(server, auth);
    this.registerComponentTools(server);
    this.registerRunTools(server, auth);
  }

  // ---------------------------------------------------------------------------
  // Workflow tools
  // ---------------------------------------------------------------------------

  private registerWorkflowTools(server: McpServer, auth: AuthContext): void {
    server.registerTool(
      'list_workflows',
      {
        description:
          'List all workflows in the organization. Returns id, name, description, and version info.',
      },
      async () => {
        const gate = this.checkPermission(auth, 'workflows.list');
        if (!gate.allowed) return gate.error;
        try {
          const workflows = await this.workflowsService.list(auth);
          const summary = workflows.map((w: ServiceWorkflowResponse) => ({
            id: w.id,
            name: w.name,
            description: w.description ?? null,
            currentVersion: w.currentVersion,
            currentVersionId: w.currentVersionId,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          }));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
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
        const gate = this.checkPermission(auth, 'workflows.read');
        if (!gate.allowed) return gate.error;
        try {
          const workflow = await this.workflowsService.findById(args.workflowId, auth);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(workflow, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
        }
      },
    );

    server.registerTool(
      'run_workflow',
      {
        description:
          'Start a workflow execution. Returns the run ID and initial status. Use get_run_status to poll for completion.',
        inputSchema: {
          workflowId: z.string().uuid(),
          inputs: z.record(z.string(), z.unknown()).optional(),
          versionId: z.string().uuid().optional(),
        },
      },
      async (args: {
        workflowId: string;
        inputs?: Record<string, unknown>;
        versionId?: string;
      }) => {
        const gate = this.checkPermission(auth, 'workflows.run');
        if (!gate.allowed) return gate.error;
        try {
          const handle = await this.workflowsService.run(
            args.workflowId,
            { inputs: args.inputs ?? {}, versionId: args.versionId },
            auth,
            {
              trigger: {
                type: 'api',
                sourceId: auth.userId ?? 'api-key',
                label: 'Studio MCP',
              },
            },
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    runId: handle.runId,
                    workflowId: handle.workflowId,
                    status: handle.status,
                    workflowVersion: handle.workflowVersion,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return this.errorResult(error);
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Component tools
  // ---------------------------------------------------------------------------

  private registerComponentTools(server: McpServer): void {
    server.registerTool(
      'list_components',
      {
        description:
          'List all available workflow components (nodes) with their category, description, and whether they are agent-callable.',
      },
      async () => {
        try {
          const entries = componentRegistry.listMetadata();
          const components = entries.map((entry: CachedComponentMetadata) => {
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
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(components, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
        }
      },
    );

    server.registerTool(
      'get_component',
      {
        description:
          'Get detailed information about a specific component, including its full input/output/parameter schemas.',
        inputSchema: { componentId: z.string() },
      },
      async (args: { componentId: string }) => {
        try {
          const entry = componentRegistry.getMetadata(args.componentId);
          if (!entry) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Component "${args.componentId}" not found`,
                },
              ],
              isError: true,
            };
          }
          const def = entry.definition;
          const category = categorizeComponent(def);
          const result = {
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
            examples: def.ui?.examples ?? [],
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Run tools
  // ---------------------------------------------------------------------------

  private registerRunTools(server: McpServer, auth: AuthContext): void {
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
        const gate = this.checkPermission(auth, 'runs.read');
        if (!gate.allowed) return gate.error;
        try {
          const result = await this.workflowsService.listRuns(auth, {
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
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(runs, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
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
        const gate = this.checkPermission(auth, 'runs.read');
        if (!gate.allowed) return gate.error;
        try {
          const status = await this.workflowsService.getRunStatus(args.runId, undefined, auth);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
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
        const gate = this.checkPermission(auth, 'runs.read');
        if (!gate.allowed) return gate.error;
        try {
          const result = await this.workflowsService.getRunResult(args.runId, undefined, auth);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return this.errorResult(error);
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
        const gate = this.checkPermission(auth, 'runs.cancel');
        if (!gate.allowed) return gate.error;
        try {
          await this.workflowsService.cancelRun(args.runId, undefined, auth);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ cancelled: true, runId: args.runId }, null, 2),
              },
            ],
          };
        } catch (error) {
          return this.errorResult(error);
        }
      },
    );
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
