import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

// Schema for resolved configuration response
const ResolvedConfigSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  args: z.array(z.string()).optional(),
});

// Schema for discovered MCP tools
const McpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export type McpTool = z.infer<typeof McpToolSchema>;

/**
 * Fetch server details from backend API
 */
export async function fetchEnabledServers(
  enabledServerIds: string[],
  context: ExecutionContext,
): Promise<McpServer[]> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3211';
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const orgId = context.metadata.organizationId;

  const response = await fetch(`${backendUrl}/api/v1/mcp-servers`, {
    headers: {
      'Content-Type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {}),
      ...(orgId ? { 'x-organization-id': orgId } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch enabled servers: ${response.statusText}`);
  }

  const allServers = (await response.json()) as unknown[];
  return allServers
    .map((s) => McpServerSchema.parse(s))
    .filter((s) => enabledServerIds.includes(s.id));
}

export async function fetchResolvedConfig(
  serverId: string,
  context: ExecutionContext,
): Promise<{ headers?: Record<string, string>; args?: string[] }> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3211';
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const orgId = context.metadata.organizationId;

  // Fetch resolved configuration using internal token auth
  const resolveResponse = await fetch(`${backendUrl}/api/v1/mcp-servers/${serverId}/resolve`, {
    headers: {
      'Content-Type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {}),
      ...(orgId ? { 'x-organization-id': orgId } : {}),
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
 * Discover tools from an MCP endpoint using the MCP SDK Client.
 *
 * Uses Client + StreamableHTTPClientTransport so that a proper `initialize`
 * handshake is performed before `tools/list`.  Many MCP servers reject a bare
 * `tools/list` without initialization.
 */
async function discoverToolsFromEndpoint(
  endpoint: string,
  headers?: Record<string, string>,
  maxRetries = 8,
  baseDelayMs = 1000,
): Promise<McpTool[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client: Client | null = null;
    try {
      console.log(
        `[discoverTools] Attempt ${attempt}/${maxRetries}: Discovering tools from ${endpoint}`,
      );

      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Accept: 'application/json, text/event-stream',
            ...(headers || {}),
          },
        },
      });

      client = new Client(
        { name: 'shipsec-worker-tool-discovery', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      const res = await client.listTools();
      await client.close().catch(() => {});

      const tools = (res.tools ?? []).map((t) => McpToolSchema.parse(t));
      console.log(`[discoverTools] ✓ Discovered ${tools.length} tools on attempt ${attempt}`);
      return tools;
    } catch (error) {
      lastError = error as Error;
      await client?.close().catch(() => {});

      if (attempt < maxRetries) {
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 5000);
        console.log(`[discoverTools] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(`[discoverTools] ✗ Failed after ${maxRetries} attempts: ${lastError?.message}`);
  return [];
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

    // Discover tools from the running container
    const tools = await discoverToolsFromEndpoint(endpoint, resolvedConfig.headers);

    // Register the server with pre-discovered tools
    await registerMcpServer({
      runId: context.runId,
      nodeId: context.componentRef,
      serverName: server.name,
      serverId: server.id,
      transport: 'stdio',
      endpoint,
      containerId,
      headers: resolvedConfig.headers,
      tools,
    });
  }
  // For HTTP servers, register directly with resolved headers
  else if (server.transportType === 'http' && server.endpoint) {
    // Discover tools from the HTTP endpoint
    const tools = await discoverToolsFromEndpoint(server.endpoint, resolvedConfig.headers);

    await registerMcpServer({
      runId: context.runId,
      nodeId: context.componentRef,
      serverName: server.name,
      serverId: server.id,
      transport: 'http',
      endpoint: server.endpoint,
      headers: resolvedConfig.headers,
      tools,
    });
  } else {
    throw new Error(`Unsupported server type: ${server.transportType}`);
  }
}

/**
 * Register MCP server with backend using the new clean API.
 * This sends the server info along with pre-discovered tools.
 */
async function registerMcpServer(input: {
  runId: string;
  nodeId: string;
  serverName: string;
  serverId: string;
  transport: 'http' | 'stdio';
  endpoint: string;
  containerId?: string;
  headers?: Record<string, string>;
  tools: McpTool[];
}): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3211';
  const internalApiUrl = `${backendUrl}/api/v1/internal/mcp`;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  const registerResponse = await fetch(`${internalApiUrl}/register-mcp-server`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(internalToken ? { 'x-internal-token': internalToken } : {}),
    },
    body: JSON.stringify({
      runId: input.runId,
      nodeId: input.nodeId,
      serverName: input.serverName,
      serverId: input.serverId,
      transport: input.transport,
      endpoint: input.endpoint,
      containerId: input.containerId,
      headers: input.headers,
      tools: input.tools,
    }),
  });

  if (!registerResponse.ok) {
    throw new Error(`Failed to register server ${input.serverId}: ${registerResponse.statusText}`);
  }

  console.log(
    `[registerMcpServer] Registered ${input.serverName} with ${input.tools.length} tools`,
  );
}
