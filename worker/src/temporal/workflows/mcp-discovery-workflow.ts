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

// Activity interface
interface DiscoverMcpToolsActivityInput {
  transport: 'http' | 'stdio';
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
}

interface DiscoverMcpToolsActivityOutput {
  tools: McpTool[];
}

// Proxy activities with 30 second timeout
const { discoverMcpToolsActivity, cacheDiscoveryResultActivity } = proxyActivities<{
  discoverMcpToolsActivity(
    input: DiscoverMcpToolsActivityInput,
  ): Promise<DiscoverMcpToolsActivityOutput>;
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
