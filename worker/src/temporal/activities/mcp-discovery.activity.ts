import { startMcpDockerServer } from '../../components/core/mcp-runtime';
import { createExecutionContext } from '@shipsec/component-sdk';
import type { DiscoveryActivityInput, DiscoveryActivityOutput, McpTool } from '../types';
import Redis from 'ioredis';

// Initialize Redis for caching
const redisUrl =
  process.env.REDIS_URL || process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

/**
 * Cache discovery results in Redis
 */
export async function cacheDiscoveryResultActivity(input: {
  cacheToken: string;
  tools: McpTool[];
  workflowId: string;
}): Promise<void> {
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
 * Supports both HTTP (direct connection) and STDIO (Docker container) transports.
 *
 * For STDIO transport:
 * - Spawns a Docker container using the stdio-proxy image
 * - Waits for the container to be ready
 * - Discovers tools via MCP protocol
 * - Cleans up the container in finally block
 *
 * For HTTP transport:
 * - Connects directly to the endpoint
 * - Tests connection with initialize
 * - Discovers tools via MCP protocol
 */
export async function discoverMcpToolsActivity(
  input: DiscoveryActivityInput,
): Promise<DiscoveryActivityOutput> {
  let containerId: string | undefined;

  try {
    let endpoint: string;

    // HTTP: direct connection
    if (input.transport === 'http') {
      if (!input.endpoint) {
        throw new Error('endpoint is required for http transport');
      }
      endpoint = input.endpoint;
      await testMcpConnection(endpoint, input.headers);
    }
    // STDIO: spawn Docker container
    else if (input.transport === 'stdio') {
      if (!input.command) {
        throw new Error('command is required for stdio transport');
      }
      const result = await spawnStdioContainer({
        command: input.command,
        args: input.args || [],
      });
      containerId = result.containerId;
      if (!containerId) {
        throw new Error('Container ID is required for STDIO transport');
      }
      endpoint = result.endpoint;
      // Wait for container to be ready with health check
      await waitForContainerReady(endpoint);
    } else {
      throw new Error(`Unsupported transport: ${(input as any).transport}`);
    }

    // Discover tools
    const tools = await listMcpTools(endpoint, input.headers);
    return { tools };
  } finally {
    // Always cleanup
    if (containerId) {
      await cleanupContainer(containerId);
    }
  }
}

/**
 * Spawn stdio container using existing mcp-runtime.ts
 */
async function spawnStdioContainer(input: {
  command: string;
  args: string[];
}): Promise<{ containerId: string; endpoint: string }> {
  // Create minimal execution context for Docker runner
  const context = createExecutionContext({
    runId: `mcp-discovery-${Date.now()}`,
    componentRef: 'mcp-discovery',
    logCollector: (entry) => {
      // Log to console for discovery activity
      const logMethod =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : entry.level === 'debug'
              ? console.debug
              : console.log;
      logMethod(`[MCP Discovery] ${entry.message}`);
    },
  });

  const result = await startMcpDockerServer({
    image: 'shipsec/mcp-stdio-proxy:latest',
    command: [],
    env: {
      MCP_COMMAND: input.command,
      MCP_ARGS: JSON.stringify(input.args),
    },
    port: 0, // Auto-assign
    params: {},
    context,
  });

  // containerId should always be set for Docker containers
  const containerId = result.containerId;
  if (!containerId) {
    throw new Error('Docker container ID not returned from startMcpDockerServer');
  }

  return {
    containerId,
    endpoint: result.endpoint,
  };
}

/**
 * Test MCP connection (initialize)
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
 * List tools via MCP protocol
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

/**
 * Wait for container to be ready using health check
 */
async function waitForContainerReady(endpoint: string): Promise<void> {
  const healthUrl = endpoint.replace('/mcp', '/health');
  const maxAttempts = 30; // 30 seconds total
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(healthUrl, { method: 'GET' });
      if (response.ok) {
        const data = (await response.json()) as { status?: string };
        if (data.status === 'ok') {
          console.log(`[MCP Discovery] Container ready after ${attempt + 1}s`);
          return;
        }
      }
    } catch {
      // Not ready yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Container failed to become ready after 30 seconds');
}

/**
 * Cleanup container using docker CLI
 */
async function cleanupContainer(containerId: string | undefined): Promise<void> {
  if (!containerId) {
    return;
  }
  // Validate container ID to prevent command injection
  if (!/^[a-zA-Z0-9_.-][a-zA-Z0-9_.-]*$/.test(containerId)) {
    console.warn(`[MCP Discovery] Skipping cleanup with unsafe container id: ${containerId}`);
    return;
  }

  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  try {
    await execAsync(`docker rm -f ${containerId}`);
  } catch (error) {
    console.error(`[MCP Discovery] Failed to cleanup container ${containerId}:`, error);
  }
}
