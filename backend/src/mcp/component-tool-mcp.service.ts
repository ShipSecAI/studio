import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
  getToolInputShape,
} from '@shipsec/component-sdk';
import { ToolRegistryService } from './tool-registry.service';
import { TemporalService } from '../temporal/temporal.service';

/**
 * ComponentToolMcpService
 *
 * Creates per-runId MCP server instances that expose only component-type tools
 * (type: 'component', status: 'ready') from the tool registry.
 *
 * Tool calls are executed via a dedicated Temporal workflow
 * (executeComponentToolWorkflow) — no signal/poll needed.
 *
 * This service is called by Hotplug as a remote_http attachment, not by agents directly.
 */
@Injectable()
export class ComponentToolMcpService {
  private readonly logger = new Logger(ComponentToolMcpService.name);

  // Cache MCP server instances keyed by runId.
  // NOTE: In-memory, single-instance design. Use sticky sessions for horizontal scaling.
  private readonly servers = new Map<string, McpServer>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly temporalService: TemporalService,
  ) {}

  /**
   * Get or create an MCP server for the given runId.
   * The server is freshly built each time it is requested so that tool-list
   * changes made after the first request are visible to callers.
   *
   * We avoid a long-lived cached server here because the Hotplug transport is
   * stateless (new HTTP connection per request). Caching would prevent tools
   * registered after the first call from appearing in subsequent calls.
   */
  async getServerForRun(runId: string): Promise<McpServer> {
    const existing = this.servers.get(runId);
    if (existing) {
      this.logger.debug(`[ComponentToolMcp] Returning cached server for run=${runId}`);
      return existing;
    }

    this.logger.log(`[ComponentToolMcp] Creating new MCP server for run=${runId}`);
    const server = new McpServer({
      name: 'shipsec-component-tool-gateway',
      version: '1.0.0',
    });

    await this.registerComponentTools(server, runId);
    this.servers.set(runId, server);
    return server;
  }

  /**
   * Rebuild the cached server for a run so newly-registered tools are picked up.
   * Called after a new component tool is registered while a session is active.
   */
  async refreshServerForRun(runId: string): Promise<void> {
    if (!this.servers.has(runId)) {
      return;
    }

    this.logger.log(`[ComponentToolMcp] Refreshing server for run=${runId}`);
    const existing = this.servers.get(runId);
    if (existing) {
      await existing.close().catch(() => {});
    }
    this.servers.delete(runId);
    // Rebuild on next request
  }

  /**
   * Destroy the cached server for a run when the workflow ends.
   */
  async cleanupRun(runId: string): Promise<void> {
    const server = this.servers.get(runId);
    if (server) {
      await server.close().catch((err: unknown) => {
        this.logger.warn(`[ComponentToolMcp] Error closing server for run=${runId}: ${err}`);
      });
      this.servers.delete(runId);
      this.logger.log(`[ComponentToolMcp] Cleaned up server for run=${runId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async registerComponentTools(server: McpServer, runId: string): Promise<void> {
    const allTools = await this.toolRegistry.getToolsForRun(runId);
    const componentTools = allTools.filter(
      (t) => t.type === 'component' && t.status === 'ready' && t.exposedToAgent !== false,
    );

    this.logger.log(
      `[ComponentToolMcp] Registering ${componentTools.length} component tool(s) for run=${runId}`,
    );

    for (const tool of componentTools) {
      const component = tool.componentId ? componentRegistry.get(tool.componentId) : null;
      const inputShape = component ? getToolInputShape(component) : undefined;

      server.registerTool(
        tool.toolName,
        {
          description: tool.description,
          inputSchema: inputShape,
          _meta: { inputSchema: tool.inputSchema },
        },
        async (args: Record<string, unknown>) => {
          const startTime = Date.now();
          this.logger.log(
            `[ComponentToolMcp] Tool call: ${tool.toolName} (run=${runId}, node=${tool.nodeId})`,
          );

          try {
            const result = await this.executeComponentTool(tool.nodeId, runId, args ?? {});
            this.logger.log(
              `[ComponentToolMcp] Tool completed: ${tool.toolName} in ${Date.now() - startTime}ms`,
            );

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `[ComponentToolMcp] Tool failed: ${tool.toolName} after ${Date.now() - startTime}ms: ${errorMessage}`,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: ${errorMessage}`,
                },
              ],
              isError: true,
            };
          }
        },
      );
    }
  }

  /**
   * Execute a component tool via a dedicated Temporal workflow.
   * Replaces the old signal/poll pattern — starts executeComponentToolWorkflow
   * and awaits the result synchronously.
   */
  private async executeComponentTool(
    nodeId: string,
    runId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = await this.toolRegistry.getTool(runId, nodeId);
    if (!tool) {
      throw new Error(`Tool not found for nodeId=${nodeId} in run=${runId}`);
    }

    if (!tool.componentId) {
      throw new Error(`Component ID missing for tool '${tool.toolName}'`);
    }

    // Split agent args into action inputs vs exposed parameter overrides
    const component = componentRegistry.get(tool.componentId);
    const actionInputIds = component ? new Set(getActionInputIds(component)) : new Set<string>();
    const exposedParamIds = component ? getExposedParameterIds(component) : [];
    const exposedParamSet = new Set(exposedParamIds);

    const inputArgs: Record<string, unknown> = {};
    const paramOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (exposedParamSet.has(key) && !actionInputIds.has(key)) {
        paramOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }

    // Decrypt and merge credentials
    const credentials = await this.toolRegistry.getToolCredentials(runId, nodeId);
    const mergedInputs = { ...(tool.preparedInputs ?? {}), ...inputArgs };
    const mergedParams = {
      ...(tool.preparedParams ?? {}),
      ...(tool.parameters ?? {}),
      ...paramOverrides,
    };

    // Execute via a dedicated short-lived Temporal workflow (no signal/poll)
    const result = await this.temporalService.executeWorkflow<{
      success: boolean;
      output?: unknown;
      error?: string;
    }>({
      workflowType: 'executeComponentToolWorkflow',
      workflowId: `tool-call:${runId}:${nodeId}:${randomUUID()}`,
      args: [
        {
          runId,
          workflowId: runId,
          nodeId: tool.nodeId,
          componentId: tool.componentId,
          inputs: mergedInputs,
          params: mergedParams,
          credentials: credentials ?? undefined,
        },
      ],
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Tool execution failed');
    }

    return result.output;
  }
}
