import { HotplugClient } from '../../utils/hotplug-client';
import type {
  DiscoveryActivityInput,
  DiscoveryActivityOutput,
  GroupDiscoveryActivityInput,
  GroupDiscoveryActivityOutput,
  GroupDiscoveryActivityResult,
  McpTool,
} from '../types';
import Redis from 'ioredis';

// Initialize Redis for caching when configured.
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl) : null;

/**
 * Cache discovery results in Redis
 */
export async function cacheDiscoveryResultActivity(input: {
  cacheToken: string;
  tools: McpTool[];
  workflowId: string;
}): Promise<void> {
  if (!redis) {
    console.warn('[MCP Discovery] Redis URL not set; skipping discovery cache write');
    return;
  }
  const key = `mcp-discovery:${input.cacheToken}`;
  const value = JSON.stringify({
    status: 'completed',
    workflowId: input.workflowId,
    tools: input.tools,
    toolCount: input.tools.length,
    cachedAt: new Date().toISOString(),
  });
  await redis.setex(key, 300, value); // 5 minutes TTL
  console.log(
    `[MCP Discovery] Cached discovery results: ${input.tools.length} tools for token ${input.cacheToken}`,
  );
}

/**
 * Retrieve cached discovery results from Redis
 */
export async function getCachedDiscoveryActivity(input: {
  cacheToken: string;
}): Promise<{ tools: McpTool[]; toolCount: number } | null> {
  if (!redis) {
    return null;
  }
  const key = `mcp-discovery:${input.cacheToken}`;
  const value = await redis.get(key);
  if (!value) {
    return null;
  }
  const cached = JSON.parse(value);
  if (cached.status !== 'completed') {
    return null;
  }
  return {
    tools: cached.tools,
    toolCount: cached.toolCount,
  };
}

/**
 * Main discovery activity for MCP servers.
 * Supports both HTTP (direct connection) and STDIO (via Hotplug) transports.
 *
 * For STDIO transport:
 * - Uses Hotplug's /discover endpoint for ephemeral tool discovery
 * - Hotplug handles container lifecycle, MCP handshake, and cleanup
 *
 * For HTTP transport:
 * - Connects directly to the endpoint
 * - Tests connection with initialize
 * - Discovers tools via MCP protocol
 */
export async function discoverMcpToolsActivity(
  input: DiscoveryActivityInput,
): Promise<DiscoveryActivityOutput> {
  // HTTP: direct connection
  if (input.transport === 'http') {
    if (!input.endpoint) {
      throw new Error('endpoint is required for http transport');
    }
    await testMcpConnection(input.endpoint, input.headers);
    const tools = await listMcpTools(input.endpoint, input.headers);
    return { tools };
  }

  // STDIO: Hotplug ephemeral discovery
  if (input.transport === 'stdio') {
    if (!input.command) {
      throw new Error('command is required for stdio transport');
    }
    const hotplug = new HotplugClient();
    const result = await hotplug.discover({
      managed: {
        runtime: 'docker',
        launch: {
          type: 'stdio',
          command: input.command,
          args: input.args || [],
        },
      },
      startup_timeout_ms: 60000,
    });

    return {
      tools: result.tools.map((t: Record<string, unknown>) => ({
        name: t.name as string,
        description: t.description as string | undefined,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      })),
    };
  }

  throw new Error(`Unsupported transport: ${(input as any).transport}`);
}

/**
 * Group discovery activity for MCP servers.
 * Discovers each stdio server in parallel via Hotplug, HTTP servers directly.
 */
export async function discoverMcpGroupToolsActivity(
  input: GroupDiscoveryActivityInput,
): Promise<GroupDiscoveryActivityOutput> {
  const stdioServers = input.servers.filter((server) => server.transport === 'stdio');
  const httpServers = input.servers.filter((server) => server.transport === 'http');
  const results: GroupDiscoveryActivityResult[] = [];

  // HTTP servers: direct connection
  for (const server of httpServers) {
    try {
      if (!server.endpoint) {
        throw new Error('endpoint is required for http transport');
      }
      await testMcpConnection(server.endpoint, server.headers);
      const tools = await listMcpTools(server.endpoint, server.headers);
      results.push({ name: server.name, tools });
    } catch (error) {
      results.push({
        name: server.name,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // STDIO servers: parallel Hotplug ephemeral discovery
  const hotplug = new HotplugClient();
  await Promise.all(
    stdioServers.map(async (server) => {
      try {
        if (!server.command) {
          throw new Error(`command is required for stdio server '${server.name}'`);
        }
        const result = await hotplug.discover({
          managed: {
            runtime: 'docker',
            launch: {
              type: 'stdio',
              command: server.command,
              args: server.args ?? [],
            },
          },
          startup_timeout_ms: 60000,
        });
        results.push({
          name: server.name,
          tools: result.tools.map((t: Record<string, unknown>) => ({
            name: t.name as string,
            description: t.description as string | undefined,
            inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          })),
        });
      } catch (error) {
        results.push({
          name: server.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return { results };
}

/**
 * Test MCP connection (initialize) — used for HTTP servers only
 */
async function testMcpConnection(
  endpoint: string,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(headers || {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'shipsec-studio', version: '1.0.0' },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP initialize failed: ${response.status}`);
  }

  const data = (await response.json()) as { error?: { message: string } };
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message}`);
  }
}

/**
 * List tools via MCP protocol — used for HTTP servers only
 */
async function listMcpTools(
  endpoint: string,
  headers?: Record<string, string>,
): Promise<McpTool[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(headers || {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP tools/list failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    error?: { message: string };
    result?: { tools?: McpTool[] };
  };
  if (data.error) {
    throw new Error(`MCP error: ${data.error.message}`);
  }

  return data.result?.tools || [];
}
