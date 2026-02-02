import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  componentRegistry,
  getActionInputIds,
  getExposedParameterIds,
  getToolInputShape,
} from '@shipsec/component-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { randomBytes } from 'node:crypto';

import { ToolRegistryService, RegisteredTool } from './tool-registry.service';
import { TemporalService } from '../temporal/temporal.service';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { TraceRepository } from '../trace/trace.repository';
import type { TraceEventType } from '../trace/types';

@Injectable()
export class McpGatewayService {
  private readonly logger = new Logger(McpGatewayService.name);

  // Cache of servers per runId
  // NOTE: This is in-memory state for active sessions. Single-instance design.
  // SCALING LIMITATION: For horizontal scaling, implement one of:
  // - Redis pub/sub for cache invalidation across instances
  // - Sticky sessions via load balancer affinity (simplest)
  // - Stateful instances dedicated to MCP gateway
  private readonly servers = new Map<string, McpServer>();
  private readonly registeredToolNames = new Map<string, Set<string>>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly temporalService: TemporalService,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly traceRepository: TraceRepository,
  ) {}

  /**
   * Get or create an MCP Server instance for a specific workflow run
   * Key includes both runId and allowedNodeIds to support multiple agents with different tool scopes
   */
  async getServerForRun(
    runId: string,
    organizationId?: string | null,
    allowedTools?: string[],
    allowedNodeIds?: string[],
  ): Promise<McpServer> {
    // 1. Validate Access
    await this.validateRunAccess(runId, organizationId);

    // Cache key includes allowedNodeIds so different agents with different tool scopes get different servers
    // Escape commas to prevent cache key collisions (e.g., ['a,b', 'c'] vs ['a', 'b,c'])
    const escapeNodeId = (id: string): string => id.replace(/,/g, '\\,');
    const cacheKey =
      allowedNodeIds && allowedNodeIds.length > 0
        ? `${runId}:${allowedNodeIds.sort().map(escapeNodeId).join(',')}`
        : runId;

    const existing = this.servers.get(cacheKey);
    if (existing) {
      return existing;
    }

    const server = new McpServer({
      name: 'shipsec-studio-gateway',
      version: '1.0.0',
    });

    const toolSet = new Set<string>();
    this.registeredToolNames.set(cacheKey, toolSet);
    await this.registerTools(server, runId, allowedTools, allowedNodeIds, toolSet);
    this.servers.set(cacheKey, server);

    return server;
  }

  /**
   * Refresh tool registrations for any cached servers for a run.
   * This is used when tools register after an MCP session has already initialized.
   */
  async refreshServersForRun(runId: string): Promise<void> {
    const matchingEntries = Array.from(this.servers.entries()).filter(
      ([key]) => key === runId || key.startsWith(`${runId}:`),
    );

    if (matchingEntries.length === 0) {
      return;
    }

    await Promise.all(
      matchingEntries.map(async ([cacheKey, server]) => {
        const allowedNodeIds =
          cacheKey === runId ? undefined : cacheKey.split(':').slice(1).join(':').split(',');
        const toolSet = this.registeredToolNames.get(cacheKey) ?? new Set<string>();
        this.registeredToolNames.set(cacheKey, toolSet);
        await this.registerTools(server, runId, undefined, allowedNodeIds, toolSet);
      }),
    );
  }

  private async validateRunAccess(runId: string, organizationId?: string | null) {
    const run = await this.workflowRunRepository.findByRunId(runId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    if (organizationId && run.organizationId !== organizationId) {
      throw new ForbiddenException(`You do not have access to workflow run ${runId}`);
    }
  }

  private async logToolCall(
    runId: string,
    toolName: string,
    status: 'STARTED' | 'COMPLETED' | 'FAILED',
    nodeRef: string,
    details: { duration?: number; error?: any; output?: any } = {},
  ) {
    try {
      const lastSeq = await this.traceRepository.getLastSequence(runId);
      const sequence = lastSeq + 1;

      const type: TraceEventType = 'NODE_PROGRESS';
      // Map status to approximate node events for visualization,
      // though 'NODE_PROGRESS' is safer if we don't want to mess up graph state.
      // But ticket asks for logging.
      // 'NODE_PROGRESS' with message is good.

      await this.traceRepository.append({
        runId,
        type,
        nodeRef,
        timestamp: new Date().toISOString(),
        sequence,
        level: status === 'FAILED' ? 'error' : 'info',
        message: `Tool ${status}: ${toolName}`,
        error: details.error,
        outputSummary: details.output,
        data: details.duration ? { duration: details.duration, toolName } : { toolName },
      });
    } catch (err) {
      this.logger.error(`Failed to log tool call: ${err}`);
    }
  }

  /**
   * Register all available tools (internal and external) for this run
   */
  private async registerTools(
    server: McpServer,
    runId: string,
    allowedTools?: string[],
    allowedNodeIds?: string[],
    registeredToolNames?: Set<string>,
  ) {
    const allRegistered = await this.toolRegistry.getToolsForRun(runId, allowedNodeIds);

    // Filter by allowed tools if specified
    if (allowedTools && allowedTools.length > 0) {
      // Note: For external tools, we need to check the proxied name, so we can't filter sources yet.
      // We filter individual tools below.
      // For component tools, we can filter here.
      // But let's simplify and just filter inside the loops.
    }

    // 1. Register Internal Tools
    const internalTools = allRegistered.filter((t) => t.type === 'component');
    for (const tool of internalTools) {
      if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(tool.toolName)) {
        continue;
      }

      if (registeredToolNames?.has(tool.toolName)) {
        continue;
      }

      const component = tool.componentId ? componentRegistry.get(tool.componentId) : null;
      const inputShape = component ? getToolInputShape(component) : undefined;

      server.registerTool(
        tool.toolName,
        {
          description: tool.description,
          inputSchema: inputShape,
          _meta: { inputSchema: tool.inputSchema },
        },
        async (args: any) => {
          const startTime = Date.now();
          await this.logToolCall(runId, tool.toolName, 'STARTED', tool.nodeId);

          try {
            const result = await this.callComponentTool(tool, runId, args ?? {});

            await this.logToolCall(runId, tool.toolName, 'COMPLETED', tool.nodeId, {
              duration: Date.now() - startTime,
              output: result,
            });

            // Signal Temporal that the tool call is completed
            await this.temporalService.signalWorkflow({
              workflowId: runId,
              signalName: 'toolCallCompleted',
              args: {
                nodeRef: tool.nodeId,
                toolName: tool.toolName,
                output: result,
                status: 'completed',
              },
            });

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

            await this.logToolCall(runId, tool.toolName, 'FAILED', tool.nodeId, {
              duration: Date.now() - startTime,
              error: errorMessage,
            });

            // Signal Temporal that the tool call failed
            await this.temporalService.signalWorkflow({
              workflowId: runId,
              signalName: 'toolCallCompleted',
              args: {
                nodeRef: tool.nodeId,
                toolName: tool.toolName,
                output: null,
                status: 'failed',
                errorMessage,
              },
            });

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
      registeredToolNames?.add(tool.toolName);
    }

    // 2. Register External Tools (Proxied)
    const externalSources = allRegistered.filter((t) => t.type !== 'component');
    for (const source of externalSources) {
      try {
        const tools = await this.fetchExternalTools(source);
        const prefix = source.toolName;

        for (const t of tools) {
          const proxiedName = `${prefix}__${t.name}`;

          if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(proxiedName)) {
            continue;
          }

          if (registeredToolNames?.has(proxiedName)) {
            continue;
          }

          server.registerTool(
            proxiedName,
            {
              description: t.description,
              _meta: { inputSchema: t.inputSchema },
            },
            async (args: any) => {
              const startTime = Date.now();
              const nodeRef = `mcp:${proxiedName}`;
              await this.logToolCall(runId, proxiedName, 'STARTED', nodeRef);

              try {
                const result = await this.proxyCallToExternal(source, t.name, args);

                await this.logToolCall(runId, proxiedName, 'COMPLETED', nodeRef, {
                  duration: Date.now() - startTime,
                  output: result,
                });
                return result;
              } catch (err) {
                await this.logToolCall(runId, proxiedName, 'FAILED', nodeRef, {
                  duration: Date.now() - startTime,
                  error: err,
                });
                throw err;
              }
            },
          );
          registeredToolNames?.add(proxiedName);
        }
      } catch (error) {
        this.logger.error(`Failed to fetch tools from external source ${source.toolName}:`, error);
      }
    }
  }

  /**
   * Fetches tools from an external MCP source
   */
  private async fetchExternalTools(source: RegisteredTool): Promise<any[]> {
    if (!source.endpoint) {
      this.logger.warn(`[TOOL REGISTRY] Missing endpoint for external source ${source.toolName}`);
      return [];
    }

    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 1000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const sessionId = `stdio-proxy-${Date.now()}-${randomBytes(8).toString('hex')}`;

      const transport = new StreamableHTTPClientTransport(new URL(source.endpoint), {
        requestInit: {
          headers: {
            'Mcp-Session-Id': sessionId,
            Accept: 'application/json, text/event-stream',
          },
        },
      });
      const client = new Client(
        { name: 'shipsec-gateway-client', version: '1.0.0' },
        { capabilities: {} },
      );

      try {
        await client.connect(transport);
        const response = await client.listTools();
        return response.tools;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `listTools failed for ${source.toolName} (attempt ${attempt}/${MAX_RETRIES}): ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      } finally {
        await client.close();
      }
    }

    if (lastError) {
      throw lastError;
    }
    return [];
  }

  /**
   * Proxies a tool call to an external MCP source
   */
  private async proxyCallToExternal(
    source: RegisteredTool,
    toolName: string,
    args: any,
  ): Promise<any> {
    if (!source.endpoint) {
      throw new McpError(
        ErrorCode.InternalError,
        `Missing endpoint for external source ${source.toolName}`,
      );
    }

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 30000;

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const sessionId = `stdio-proxy-${Date.now()}-${randomBytes(8).toString('hex')}`;
      const transport = new StreamableHTTPClientTransport(new URL(source.endpoint), {
        requestInit: {
          headers: {
            'Mcp-Session-Id': sessionId,
            Accept: 'application/json, text/event-stream',
          },
        },
      });
      const client = new Client(
        { name: 'shipsec-gateway-client', version: '1.0.0' },
        { capabilities: {} },
      );

      try {
        await client.connect(transport);

        const result = await Promise.race([
          client.callTool({
            name: toolName,
            arguments: args,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool call timed out after ${TIMEOUT_MS}ms`)),
              TIMEOUT_MS,
            ),
          ),
        ]);

        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`External tool call attempt ${attempt} failed: ${error}`);
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      } finally {
        await client.close().catch(() => {});
      }
    }

    throw lastError;
  }

  /**
   * Internal handler for executing component-based tools via Temporal workflow
   */
  private async callComponentTool(
    tool: RegisteredTool,
    runId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!tool.componentId) {
      throw new BadRequestException(`Component ID missing for tool '${tool.toolName}'`);
    }

    const component = componentRegistry.get(tool.componentId);
    const actionInputIds = component ? new Set(getActionInputIds(component)) : new Set<string>();
    const exposedParamIds = component ? getExposedParameterIds(component) : [];
    const exposedParamSet = new Set(exposedParamIds);

    const inputArgs: Record<string, unknown> = {};
    const paramOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args ?? {})) {
      if (exposedParamSet.has(key) && !actionInputIds.has(key)) {
        paramOverrides[key] = value;
      } else {
        inputArgs[key] = value;
      }
    }

    // Resolve credentials from registry
    const credentials = await this.toolRegistry.getToolCredentials(runId, tool.nodeId);

    const mergedParams = { ...(tool.parameters ?? {}), ...paramOverrides };

    // Generate a unique call ID for this tool invocation
    const callId = `${runId}:${tool.nodeId}:${Date.now()}`;

    // Signal the workflow to execute the tool
    await this.temporalService.signalWorkflow({
      workflowId: runId,
      signalName: 'executeToolCall',
      args: {
        callId,
        nodeId: tool.nodeId,
        componentId: tool.componentId,
        arguments: inputArgs,
        parameters: mergedParams,
        credentials: credentials ?? undefined,
        requestedAt: new Date().toISOString(),
      },
    });

    // Poll for the result via workflow query
    // The workflow will execute the component and store the result
    const result = await this.pollForToolCallResult(runId, callId);

    if (!result.success) {
      throw new Error(result.error ?? 'Tool execution failed');
    }

    return result.output;
  }

  /**
   * Poll the workflow for a tool call result
   */
  private async pollForToolCallResult(
    runId: string,
    callId: string,
    timeoutMs = 60000,
    pollIntervalMs = 500,
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Query the workflow for tool call results
        const result = await this.temporalService.queryWorkflow({
          workflowId: runId,
          queryType: 'getToolCallResult',
          args: [callId],
        });

        if (result) {
          return result as { success: boolean; output?: unknown; error?: string };
        }
      } catch (_error) {
        // Query might fail if workflow is busy, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { success: false, error: `Tool call timed out after ${timeoutMs}ms` };
  }

  /**
   * Cleanup server instance for a run
   */
  async cleanupRun(runId: string) {
    const server = this.servers.get(runId);
    if (server) {
      await server.close();
      this.servers.delete(runId);
    }
  }
}
