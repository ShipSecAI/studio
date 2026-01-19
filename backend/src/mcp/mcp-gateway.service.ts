import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { componentRegistry } from '@shipsec/component-sdk';

import { ToolRegistryService, RegisteredTool } from './tool-registry.service';
import { TemporalService } from '../temporal/temporal.service';

@Injectable()
export class McpGatewayService {
  private readonly logger = new Logger(McpGatewayService.name);
  
  // Cache of servers per runId
  private readonly servers = new Map<string, McpServer>();

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly temporalService: TemporalService,
  ) {}

  /**
   * Get or create an MCP Server instance for a specific workflow run
   */
  async getServerForRun(runId: string): Promise<McpServer> {
    const existing = this.servers.get(runId);
    if (existing) {
      return existing;
    }

    const server = new McpServer(
      {
        name: 'shipsec-studio-gateway',
        version: '1.0.0',
      }
    );

    await this.registerTools(server, runId);
    this.servers.set(runId, server);
    
    return server;
  }

  /**
   * Register all available tools (internal and external) for this run
   */
  private async registerTools(server: McpServer, runId: string) {
    const allRegistered = await this.toolRegistry.getToolsForRun(runId);
    
    // 1. Register Internal Tools
    const internalTools = allRegistered.filter((t) => t.type === 'component');
    for (const tool of internalTools) {
      server.registerTool(
        tool.toolName,
        {
          description: tool.description,
          _meta: { inputSchema: tool.inputSchema },
        },
        async (args: any) => {
          try {
            const result = await this.callComponentTool(tool, runId, args ?? {});
            
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
        }
      );
    }

    // 2. Register External Tools (Proxied)
    const externalSources = allRegistered.filter((t) => t.type !== 'component');
    for (const source of externalSources) {
      try {
        const tools = await this.fetchExternalTools(source);
        const prefix = source.toolName;
        
        for (const t of tools) {
          const proxiedName = `${prefix}__${t.name}`;
          server.registerTool(
            proxiedName,
            {
              description: t.description,
              _meta: { inputSchema: t.inputSchema },
            },
            async (args: any) => {
              return this.proxyCallToExternal(source, t.name, args);
            }
          );
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
    if (!source.endpoint) return [];

    const transport = new SSEClientTransport(new URL(source.endpoint));
    const client = new Client(
      { name: 'shipsec-gateway-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    try {
      const response = await client.listTools();
      return response.tools;
    } finally {
      await client.close();
    }
  }

  /**
   * Proxies a tool call to an external MCP source
   */
  private async proxyCallToExternal(
    source: RegisteredTool,
    toolName: string,
    args: any
  ): Promise<any> {
    if (!source.endpoint) {
      throw new McpError(ErrorCode.InternalError, `Missing endpoint for external source ${source.toolName}`);
    }

    const transport = new SSEClientTransport(new URL(source.endpoint));
    const client = new Client(
      { name: 'shipsec-gateway-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    try {
      return await client.callTool({
        name: toolName,
        arguments: args,
      });
    } finally {
      await client.close();
    }
  }

  /**
   * Internal handler for executing component-based tools
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
    if (!component) {
      throw new NotFoundException(`Component '${tool.componentId}' not found in registry`);
    }

    // Resolve credentials from registry
    const credentials = await this.toolRegistry.getToolCredentials(runId, tool.nodeId);

    this.logger.log(`Executing tool '${tool.toolName}' (${tool.componentId}) for run ${runId}`);

    // Merge credentials (pre-bound) and agent arguments (action inputs)
    const mergedInputs = {
      ...(credentials ?? {}),
      ...args,
    };

    // Execute the component logic
    return await component.execute(
      { inputs: mergedInputs as any, params: {} as any },
      {
        runId,
        componentRef: tool.nodeId,
        logger: new Logger(`Tool:${tool.toolName}`) as any,
        emitProgress: () => {},
        http: {
          fetch: fetch as any,
          toCurl: () => 'curl ...',
        },
        metadata: {
          correlationId: `${runId}:${tool.nodeId}:mcp`,
        } as any,
      },
    );
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
