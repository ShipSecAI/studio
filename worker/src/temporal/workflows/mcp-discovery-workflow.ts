import {
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type { McpTool } from '@shipsec/shared';

// Input DTO for MCP discovery workflow
export interface DiscoveryInput {
  transport: 'http' | 'stdio';
  name: string;
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  image?: string;
  cacheToken?: string;
}

// Output DTO for MCP discovery workflow
export interface DiscoveryResult {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpTool[];
  toolCount?: number;
  error?: string;
  errorCode?: string;
}

// Query result DTO (same as DiscoveryResult but without workflowId in the query response)
export interface DiscoveryQueryResult {
  status: 'running' | 'completed' | 'failed';
  tools?: McpTool[];
  toolCount?: number;
  error?: string;
  errorCode?: string;
}

export interface GroupDiscoveryInput {
  servers: {
    name: string;
    transport: 'http' | 'stdio';
    endpoint?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
  }[];
  image?: string;
  cacheTokens?: Record<string, string>;
}

export interface GroupDiscoveryResultEntry {
  name: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpTool[];
  toolCount?: number;
  error?: string;
  cacheToken?: string;
}

export interface GroupDiscoveryResult {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  results?: GroupDiscoveryResultEntry[];
  error?: string;
  errorCode?: string;
}

export interface GroupDiscoveryQueryResult {
  status: 'running' | 'completed' | 'failed';
  results?: GroupDiscoveryResultEntry[];
  error?: string;
  errorCode?: string;
}

// Activity interface
interface DiscoverMcpToolsActivityInput {
  transport: 'http' | 'stdio';
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  image?: string;
}

interface DiscoverMcpToolsActivityOutput {
  tools: McpTool[];
}

interface DiscoverMcpGroupToolsActivityInput {
  servers: {
    name: string;
    transport: 'http' | 'stdio';
    endpoint?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
  }[];
  image?: string;
}

interface DiscoverMcpGroupToolsActivityOutput {
  results: { name: string; tools: McpTool[]; error?: string }[];
}

// Proxy activities with 30 second timeout
const { discoverMcpToolsActivity, discoverMcpGroupToolsActivity, cacheDiscoveryResultActivity } =
  proxyActivities<{
    discoverMcpToolsActivity(
      input: DiscoverMcpToolsActivityInput,
    ): Promise<DiscoverMcpToolsActivityOutput>;
    discoverMcpGroupToolsActivity(
      input: DiscoverMcpGroupToolsActivityInput,
    ): Promise<DiscoverMcpGroupToolsActivityOutput>;
    cacheDiscoveryResultActivity(input: {
      cacheToken: string;
      tools: McpTool[];
      workflowId: string;
    }): Promise<void>;
  }>({
    startToCloseTimeout: '30 seconds',
  });

/**
 * MCP Discovery Workflow
 *
 * Discovers tools from an MCP server (HTTP or STDIO transport).
 * Validates input, calls the discovery activity, and returns structured results.
 *
 * Supports query handler 'getDiscoveryResult' for polling workflow status.
 */
export async function mcpDiscoveryWorkflow(input: DiscoveryInput): Promise<DiscoveryResult> {
  // Get workflow ID from current workflow info
  const workflowId = workflowInfo().workflowId;

  // Track discovery result for query handler
  let discoveryResult: DiscoveryQueryResult = {
    status: 'running',
  };

  // Set up query handler for polling discovery status
  setHandler(defineQuery<DiscoveryQueryResult>('getDiscoveryResult'), () => discoveryResult);

  // Step 1: Validate input
  if (input.transport === 'http' && !input.endpoint) {
    discoveryResult = {
      status: 'failed',
      error: 'HTTP transport requires endpoint',
      errorCode: 'INVALID_INPUT',
    };
    return {
      workflowId,
      ...discoveryResult,
    };
  }
  if (input.transport === 'stdio' && !input.command) {
    discoveryResult = {
      status: 'failed',
      error: 'STDIO transport requires command',
      errorCode: 'INVALID_INPUT',
    };
    return {
      workflowId,
      ...discoveryResult,
    };
  }

  try {
    // Step 2: Call discoverMcpTools activity
    const discovery = await discoverMcpToolsActivity({
      transport: input.transport,
      endpoint: input.endpoint,
      command: input.command,
      args: input.args,
      headers: input.headers,
      image: input.image,
    });

    // Step 3: Cache results if cacheToken provided
    if (input.cacheToken) {
      try {
        await cacheDiscoveryResultActivity({
          cacheToken: input.cacheToken,
          tools: discovery.tools,
          workflowId,
        });
      } catch (cacheError) {
        // Log cache error but don't fail the workflow
        console.error('[mcpDiscoveryWorkflow] Failed to cache discovery results:', cacheError);
      }
    }

    // Step 4: Update result
    discoveryResult = {
      status: 'completed',
      tools: discovery.tools,
      toolCount: discovery.tools.length,
    };

    return {
      workflowId,
      ...discoveryResult,
    };
  } catch (error) {
    // Handle activity failures
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNonRetryable = error instanceof ApplicationFailure && error.nonRetryable;

    discoveryResult = {
      status: 'failed',
      error: errorMessage,
      errorCode: isNonRetryable ? 'NON_RETRYABLE_FAILURE' : 'ACTIVITY_FAILURE',
    };

    return {
      workflowId,
      ...discoveryResult,
    };
  }
}

/**
 * MCP Group Discovery Workflow
 *
 * Discovers tools from multiple MCP servers with a single stdio proxy container.
 * Supports query handler 'getGroupDiscoveryResult' for polling workflow status.
 */
export async function mcpGroupDiscoveryWorkflow(
  input: GroupDiscoveryInput,
): Promise<GroupDiscoveryResult> {
  const workflowId = workflowInfo().workflowId;

  let discoveryResult: GroupDiscoveryQueryResult = {
    status: 'running',
  };

  setHandler(
    defineQuery<GroupDiscoveryQueryResult>('getGroupDiscoveryResult'),
    () => discoveryResult,
  );

  const invalid = input.servers.find((server) =>
    server.transport === 'http' ? !server.endpoint : !server.command,
  );
  if (invalid) {
    discoveryResult = {
      status: 'failed',
      error: `Invalid server config for ${invalid.name}`,
      errorCode: 'INVALID_INPUT',
    };
    return {
      workflowId,
      ...discoveryResult,
    };
  }

  try {
    const discovery = await discoverMcpGroupToolsActivity({
      servers: input.servers,
      image: input.image,
    });

    const results: GroupDiscoveryResultEntry[] = discovery.results.map((result) => {
      const cacheToken = input.cacheTokens?.[result.name];
      return {
        name: result.name,
        status: result.error ? 'failed' : 'completed',
        tools: result.tools,
        toolCount: result.tools.length,
        error: result.error,
        cacheToken,
      };
    });

    for (const result of results) {
      if (result.status === 'completed' && result.cacheToken) {
        try {
          await cacheDiscoveryResultActivity({
            cacheToken: result.cacheToken,
            tools: result.tools ?? [],
            workflowId,
          });
        } catch (cacheError) {
          console.error(
            '[mcpGroupDiscoveryWorkflow] Failed to cache discovery results:',
            cacheError,
          );
        }
      }
    }

    discoveryResult = {
      status: 'completed',
      results,
    };

    return {
      workflowId,
      ...discoveryResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNonRetryable = error instanceof ApplicationFailure && error.nonRetryable;

    discoveryResult = {
      status: 'failed',
      error: errorMessage,
      errorCode: isNonRetryable ? 'NON_RETRYABLE_FAILURE' : 'ACTIVITY_FAILURE',
    };

    return {
      workflowId,
      ...discoveryResult,
    };
  }
}
