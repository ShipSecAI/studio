import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { startMcpDockerServer } from './mcp-runtime';

// Schema matching backend API response (McpServerResponse from mcp-servers.dto.ts)
const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  hasHeaders: z.boolean().optional(),
  headerKeys: z.array(z.string()).nullable().optional(),
  enabled: z.boolean(),
  healthCheckUrl: z.string().nullable().optional(),
  lastHealthCheck: z.string().nullable().optional(),
  lastHealthStatus: z.enum(['healthy', 'unhealthy', 'unknown']).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSchema),
});

// Schema for resolved configuration response
const ResolvedConfigSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  args: z.array(z.string()).optional(),
});

/**
 * Fetch server details from backend API
 */
export async function fetchEnabledServers(
  serverIds: string[],
  _context: ExecutionContext,
): Promise<McpServer[]> {
  if (serverIds.length === 0) {
    return [];
  }

  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

  // Fetch all servers - we need to filter by enabled status
  const response = await fetch(`${backendUrl}/api/v1/mcp-servers`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch MCP servers: ${response.statusText}`);
  }

  const data = await response.json();
  const parsed = ListMcpServersResponseSchema.parse(data);

  // Filter to only enabled servers that are in the selected list
  return parsed.servers.filter((s) => serverIds.includes(s.id) && s.enabled);
}

/**
 * Fetch resolved configuration for a specific server (with secrets resolved)
 * This is used when connecting to an MCP server that has secret references
 */
export async function fetchResolvedConfig(
  serverId: string,
  context: ExecutionContext,
): Promise<{ headers?: Record<string, string>; args?: string[] }> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  const internalApiUrl = `${backendUrl}/internal/mcp`;

  // Get internal API token for authentication
  const tokenResponse = await fetch(`${internalApiUrl}/generate-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: context.runId,
      allowedNodeIds: [context.componentRef],
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to generate internal API token: ${tokenResponse.statusText}`);
  }

  const { token } = (await tokenResponse.json()) as { token: string };

  // Fetch resolved configuration
  const resolveResponse = await fetch(`${backendUrl}/api/v1/mcp-servers/${serverId}/resolve`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!resolveResponse.ok) {
    throw new Error(
      `Failed to fetch resolved config for server ${serverId}: ${resolveResponse.statusText}`,
    );
  }

  const data = await resolveResponse.json();
  return ResolvedConfigSchema.parse(data);
}

/**
 * Register a single server's tools with Tool Registry
 */
export async function registerServerTools(
  server: McpServer,
  context: ExecutionContext,
): Promise<void> {
  // Fetch resolved configuration (with secrets resolved)
  const resolvedConfig = await fetchResolvedConfig(server.id, context);

  // For stdio servers, we need to spawn a Docker container
  if (server.transportType === 'stdio') {
    const { endpoint, containerId } = await startMcpDockerServer({
      image: 'shipsec/mcp-stdio-proxy:latest',
      command: [],
      env: {
        MCP_COMMAND: server.command || '',
        MCP_ARGS: JSON.stringify((resolvedConfig.args ?? server.args) || []),
      },
      port: 0, // Auto-assign port
      params: {},
      context,
    });

    // Register the stdio server with the endpoint
    await registerWithBackend(
      server.id,
      server.name,
      endpoint,
      containerId,
      context,
      resolvedConfig.headers,
    );
  }
  // For HTTP servers, register directly with resolved headers
  else if (server.transportType === 'http' && server.endpoint) {
    await registerWithBackend(
      server.id,
      server.name,
      server.endpoint,
      undefined,
      context,
      resolvedConfig.headers,
    );
  } else {
    throw new Error(`Unsupported server type: ${server.transportType}`);
  }
}

/**
 * Register server with backend Tool Registry
 */
async function registerWithBackend(
  serverId: string,
  serverName: string,
  endpoint: string,
  containerId: string | undefined,
  context: ExecutionContext,
  resolvedHeaders?: Record<string, string> | null,
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  const internalApiUrl = `${backendUrl}/internal/mcp`;

  // Get internal API token for authentication
  const tokenResponse = await fetch(`${internalApiUrl}/generate-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: context.runId,
      allowedNodeIds: [context.componentRef],
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to generate internal API token: ${tokenResponse.statusText}`);
  }

  const { token } = (await tokenResponse.json()) as { token: string };

  // Register the local MCP with the Tool Registry
  const registerResponse = await fetch(`${internalApiUrl}/register-local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      runId: context.runId,
      nodeId: context.componentRef,
      toolName: serverName,
      description: `MCP tools from ${serverName} (${serverId})`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      endpoint,
      containerId,
      resolvedHeaders, // Pass resolved headers so backend can use them when connecting
    }),
  });

  if (!registerResponse.ok) {
    throw new Error(`Failed to register server ${serverId}: ${registerResponse.statusText}`);
  }
}
