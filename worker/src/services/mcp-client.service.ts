/**
 * MCP Client Service
 *
 * Provides connection management, health checks, tool discovery, and tool execution
 * for MCP (Model Context Protocol) servers. Supports all transport types:
 * - HTTP (StreamableHTTPClientTransport)
 * - SSE (SSEClientTransport - legacy)
 * - WebSocket (WebSocketClientTransport)
 * - Stdio (StdioClientTransport)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as McpSdkTool } from '@modelcontextprotocol/sdk/types.js';

// Custom type for tool call results that covers both new and legacy response shapes
export interface McpToolCallResult {
  content?: {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }[];
  toolResult?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export type McpTransportType = 'http' | 'stdio' | 'sse' | 'websocket';
export type McpHealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface McpServerConfig {
  id: string;
  name: string;
  transportType: McpTransportType;
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  headers?: Record<string, string> | null;
  enabled: boolean;
  // Resolved configuration (with secrets already resolved)
  resolvedHeaders?: Record<string, string> | null;
  resolvedArgs?: string[] | null;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpHealthResult {
  serverId: string;
  status: McpHealthStatus;
  error?: string;
  toolCount?: number;
  checkedAt: Date;
}

interface CachedConnection {
  client: Client;
  transport: Transport;
  lastUsed: Date;
  serverId: string;
}

const CONNECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HEALTH_CHECK_TIMEOUT_MS = 10_000; // 10 seconds
const TOOL_CALL_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Service for managing MCP client connections and operations.
 * Implements connection pooling for efficiency.
 */
export class McpClientService {
  private connections = new Map<string, CachedConnection>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup of stale connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 60_000); // Every minute
  }

  /**
   * Creates a transport based on the server configuration.
   */
  private createTransport(config: McpServerConfig): Transport {
    switch (config.transportType) {
      case 'http': {
        if (!config.endpoint) {
          throw new Error(`HTTP transport requires an endpoint for server "${config.name}"`);
        }
        const url = new URL(config.endpoint);
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: config.resolvedHeaders ?? {},
          },
        });
        return transport;
      }

      case 'sse': {
        if (!config.endpoint) {
          throw new Error(`SSE transport requires an endpoint for server "${config.name}"`);
        }
        const url = new URL(config.endpoint);
        const transport = new SSEClientTransport(url);
        return transport;
      }

      case 'websocket': {
        if (!config.endpoint) {
          throw new Error(`WebSocket transport requires an endpoint for server "${config.name}"`);
        }
        const url = new URL(config.endpoint);
        const transport = new WebSocketClientTransport(url);
        return transport;
      }

      case 'stdio': {
        if (!config.command) {
          throw new Error(`Stdio transport requires a command for server "${config.name}"`);
        }
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.resolvedArgs ?? config.args ?? undefined,
        });
        return transport;
      }

      default:
        throw new Error(`Unknown transport type: ${config.transportType}`);
    }
  }

  /**
   * Gets or creates a connection to an MCP server.
   */
  async connect(config: McpServerConfig): Promise<Client> {
    // Check for existing connection
    const cached = this.connections.get(config.id);
    if (cached) {
      cached.lastUsed = new Date();
      return cached.client;
    }

    // Create new client and transport
    const client = new Client({
      name: `shipsec-studio-${config.id}`,
      version: '1.0.0',
    });

    const transport = this.createTransport(config);

    try {
      await client.connect(transport);

      // Cache the connection
      this.connections.set(config.id, {
        client,
        transport,
        lastUsed: new Date(),
        serverId: config.id,
      });

      return client;
    } catch (error) {
      // Clean up on failure
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      throw error;
    }
  }

  /**
   * Performs a health check on an MCP server by attempting to list its tools.
   */
  async healthCheck(config: McpServerConfig): Promise<McpHealthResult> {
    const checkedAt = new Date();

    try {
      const client = await Promise.race([
        this.connect(config),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), HEALTH_CHECK_TIMEOUT_MS),
        ),
      ]);

      // Try to list tools as a health check
      const toolsResult = await Promise.race([
        client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('List tools timeout')), HEALTH_CHECK_TIMEOUT_MS),
        ),
      ]);

      return {
        serverId: config.id,
        status: 'healthy',
        toolCount: toolsResult.tools?.length ?? 0,
        checkedAt,
      };
    } catch (error) {
      // Remove the cached connection on health check failure
      await this.disconnect(config.id);

      return {
        serverId: config.id,
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        checkedAt,
      };
    }
  }

  /**
   * Discovers available tools from an MCP server.
   */
  async discoverTools(config: McpServerConfig): Promise<McpToolInfo[]> {
    const client = await this.connect(config);

    const result = await client.listTools();

    return (result.tools ?? []).map((tool: McpSdkTool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Executes a tool call on an MCP server.
   */
  async callTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const client = await this.connect(config);

    const result = await Promise.race([
      client.callTool({
        name: toolName,
        arguments: args,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tool call timeout')), TOOL_CALL_TIMEOUT_MS),
      ),
    ]);

    return result as McpToolCallResult;
  }

  /**
   * Disconnects from a specific server.
   */
  async disconnect(serverId: string): Promise<void> {
    const cached = this.connections.get(serverId);
    if (cached) {
      try {
        await cached.client.close();
      } catch {
        // Ignore close errors
      }
      this.connections.delete(serverId);
    }
  }

  /**
   * Cleans up stale connections that haven't been used recently.
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    for (const [serverId, connection] of this.connections.entries()) {
      if (now - connection.lastUsed.getTime() > CONNECTION_TTL_MS) {
        this.disconnect(serverId).catch(() => {
          // Ignore cleanup errors
        });
      }
    }
  }

  /**
   * Cleans up all connections and stops the cleanup interval.
   */
  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const disconnectPromises = Array.from(this.connections.keys()).map((serverId) =>
      this.disconnect(serverId),
    );

    await Promise.all(disconnectPromises);
  }

  /**
   * Gets the number of active connections.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
}

// Singleton instance for use across the worker
let mcpClientServiceInstance: McpClientService | null = null;

export function getMcpClientService(): McpClientService {
  if (!mcpClientServiceInstance) {
    mcpClientServiceInstance = new McpClientService();
  }
  return mcpClientServiceInstance;
}

export async function cleanupMcpClientService(): Promise<void> {
  if (mcpClientServiceInstance) {
    await mcpClientServiceInstance.cleanup();
    mcpClientServiceInstance = null;
  }
}
