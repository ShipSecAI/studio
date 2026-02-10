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
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';

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
    private readonly mcpServersRepository: McpServersRepository,
  ) { }

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

    this.logger.log(`[getServerForRun] runId=${runId}, cacheKey=${cacheKey}, allowedNodeIds=${JSON.stringify(allowedNodeIds)}`);

    const existing = this.servers.get(cacheKey);
    if (existing) {
      this.logger.log(`[getServerForRun] Returning cached server for cacheKey=${cacheKey}`);
      return existing;
    }

    this.logger.log(`[getServerForRun] Creating NEW server for cacheKey=${cacheKey}`);
    const server = new McpServer({
      name: 'shipsec-studio-gateway',
      version: '1.0.0',
    });

    const toolSet = new Set<string>();
    this.registeredToolNames.set(cacheKey, toolSet);
    await this.registerTools(server, runId, allowedTools, allowedNodeIds, toolSet);
    this.logger.log(`[getServerForRun] After registerTools, toolSet has ${toolSet.size} tools: ${[...toolSet].join(', ')}`);
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
    console.log('[DEBUG] McpGatewayService this:', !!this);
    console.log('[DEBUG] McpGatewayService toolRegistry:', !!this.toolRegistry);
    console.log('[DEBUG] McpGatewayService temporalService:', !!this.temporalService);
    console.log('[DEBUG] McpGatewayService workflowRunRepository:', !!this.workflowRunRepository);
    console.log('[DEBUG] McpGatewayService traceRepository:', !!this.traceRepository);
    console.log('[DEBUG] McpGatewayService mcpServersRepository:', !!this.mcpServersRepository);
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
    this.logger.log(`[registerTools] START: runId=${runId}, allowedNodeIds=${JSON.stringify(allowedNodeIds)}`);
    const allRegistered = await this.toolRegistry.getToolsForRun(runId, allowedNodeIds);
    this.logger.log(`[registerTools] getToolsForRun returned ${allRegistered.length} tools:`);
    for (const t of allRegistered) {
      this.logger.log(`[registerTools]   nodeId=${t.nodeId}, toolName=${t.toolName}, type=${t.type}, status=${t.status}, endpoint=${t.endpoint?.substring(0, 80) ?? 'none'}, exposedToAgent=${t.exposedToAgent}`);
    }

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
      // Some tool-mode nodes are "providers" only (e.g. MCP groups) and should not be agent-callable.
      if (tool.exposedToAgent === false) {
        continue;
      }

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

    // DEBUG: Log all external sources for troubleshooting
    this.logger.debug(
      `[Gateway] Found ${externalSources.length} external sources for run ${runId}`,
    );
    for (const source of externalSources) {
      this.logger.debug(
        `[Gateway] External source: toolName=${source.toolName}, type=${source.type}, endpoint=${source.endpoint?.substring(0, 50)}, nodeId=${source.nodeId}`,
      );
    }

    // Filter by allowedNodeIds - support hierarchical node IDs with '/' separator
    // e.g., if allowedNodeIds includes 'aws-mcp-group', also include 'aws-mcp-group/aws-cloudtrail'
    // Also support legacy '-' separator for backward compatibility
    this.logger.debug(
      `[Gateway] Filtering ${externalSources.length} external sources with allowedNodeIds: ${allowedNodeIds?.join(', ') ?? 'none (allow all)'}`,
    );
    const filteredSources =
      allowedNodeIds && allowedNodeIds.length > 0
        ? externalSources.filter((source) => {
          // Direct match
          if (allowedNodeIds.includes(source.nodeId)) {
            this.logger.debug(
              `[Gateway] ✓ Including ${source.nodeId} (toolName=${source.toolName}) via direct match`,
            );
            return true;
          }
          // Hierarchical match with '/' separator (new format)
          // e.g., 'aws-mcp-group' matches 'aws-mcp-group/aws-cloudtrail'
          for (const allowedId of allowedNodeIds) {
            if (source.nodeId.startsWith(`${allowedId}/`)) {
              this.logger.debug(
                `[Gateway] ✓ Including ${source.nodeId} (toolName=${source.toolName}) via hierarchical match with ${allowedId}`,
              );
              return true;
            }
          }
          this.logger.debug(
            `[Gateway] ✗ Excluding ${source.nodeId} (toolName=${source.toolName}) - no match in allowedNodeIds`,
          );
          return false;
        })
        : externalSources;

    this.logger.log(`[registerTools] Processing ${filteredSources.length} external sources...`);
    for (const source of filteredSources) {
      try {
        let tools: any[] = [];

        // First, check Redis for pre-discovered tools (from registerMcpServer API)
        this.logger.log(`[registerTools] External source: nodeId=${source.nodeId}, toolName=${source.toolName}, type=${source.type}, endpoint=${source.endpoint?.substring(0, 80) ?? 'none'}`);
        const preDiscoveredTools = await this.toolRegistry.getServerTools(runId, source.nodeId);
        this.logger.log(`[registerTools]   preDiscoveredTools from Redis: ${preDiscoveredTools ? preDiscoveredTools.length : 'null'}`);
        if (preDiscoveredTools && preDiscoveredTools.length > 0) {
          this.logger.log(
            `[registerTools]   Using ${preDiscoveredTools.length} pre-discovered tools from Redis for ${source.toolName}`,
          );
          tools = preDiscoveredTools;
        } else if (source.type === 'mcp-server' || source.type === 'local-mcp') {
          // Fallback: discover tools on-the-fly from endpoint
          if (!source.endpoint) {
            this.logger.warn(`[registerTools]   MCP tool ${source.toolName} has no endpoint - skipping.`);
            continue;
          }
          this.logger.log(
            `[registerTools]   FALLBACK: Discovering tools from endpoint: ${source.endpoint}`,
          );
          tools = await this.discoverToolsFromEndpoint(source.endpoint);
          this.logger.log(`[registerTools]   FALLBACK result: discovered ${tools.length} tools from ${source.toolName}`);
          if (tools.length > 0) {
            this.logger.log(`[registerTools]   FALLBACK tool names: ${tools.map((t: any) => t.name).join(', ')}`);
          }
        } else {
          // Remote MCPs must have a serverId (pre-registered in database)
          if (!source.serverId) {
            this.logger.warn(
              `[registerTools]   External tool ${source.toolName} has no serverId - skipping.`,
            );
            continue;
          }
          this.logger.log(`[registerTools]   Loading pre-discovered tools from DB for serverId=${source.serverId}`);
          tools = await this.getPreDiscoveredTools(source.serverId);
          this.logger.log(`[registerTools]   DB result: ${tools.length} tools`);
        }

        const prefix = source.toolName;
        this.logger.log(`[registerTools]   Registering ${tools.length} tools with prefix '${prefix}'`);

        for (const t of tools) {
          const proxiedName = `${prefix}__${t.name}`;

          if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(proxiedName)) {
            this.logger.log(`[registerTools]   Skipping ${proxiedName} - not in allowedTools`);
            continue;
          }

          if (registeredToolNames?.has(proxiedName)) {
            this.logger.log(`[registerTools]   Skipping ${proxiedName} - already registered`);
            continue;
          }

          this.logger.log(`[registerTools]   Registering tool: ${proxiedName}`);
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
   * Get pre-discovered tools from the database for a registered MCP server
   */
  private async getPreDiscoveredTools(serverId: string): Promise<any[]> {
    try {
      const toolRecords = await this.mcpServersRepository.listTools(serverId);
      return toolRecords
        .filter((t) => t.enabled)
        .map((t) => ({
          name: t.toolName,
          description: t.description ?? undefined,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? undefined,
        }));
    } catch (error) {
      this.logger.error(`Failed to load pre-discovered tools for server ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Discover tools on-the-fly from an MCP endpoint (for local-mcp type)
   */
  private async discoverToolsFromEndpoint(endpoint: string): Promise<any[]> {
    try {
      // Many MCP servers require a proper initialize handshake before tools/list will succeed.
      // Use the official SDK client so discovery works consistently across servers.
      this.logger.log(`[discoverToolsFromEndpoint] START: endpoint=${endpoint}`);

      const sessionId = `tools-list-${Date.now()}-${randomBytes(8).toString('hex')}`;
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            'Mcp-Session-Id': sessionId,
            Accept: 'application/json, text/event-stream',
          },
        },
      });

      const client = new Client(
        { name: 'shipsec-gateway-tools-list', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      const res = await client.listTools();
      await client.close().catch(() => { });

      const tools = res.tools ?? [];
      this.logger.log(`[discoverToolsFromEndpoint] SUCCESS: Discovered ${tools.length} tool(s) from ${endpoint}`);
      if (tools.length > 0) {
        this.logger.log(`[discoverToolsFromEndpoint] Tool names: ${tools.map((t: any) => t.name).join(', ')}`);
      }
      return tools;
    } catch (error) {
      this.logger.error(`[discoverToolsFromEndpoint] FAILED for ${endpoint}: ${error}`);
      return [];
    }
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
        await client.close().catch(() => { });
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
