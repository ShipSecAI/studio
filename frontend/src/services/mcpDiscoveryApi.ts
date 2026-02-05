import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';

// Types for MCP discovery workflow
export interface DiscoveryInput {
  transport: 'http' | 'stdio';
  name: string;
  endpoint?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  image?: string;
}

export interface McpToolResponse {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DiscoveryStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpToolResponse[];
  toolCount?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * MCP Discovery API Service
 *
 * Provides pre-save discovery functionality for MCP servers.
 * Uses Temporal workflows for async tool discovery.
 */
export const mcpDiscoveryApi = {
  /**
   * Start a discovery workflow for a potential MCP server configuration
   */
  async discover(
    input: DiscoveryInput,
  ): Promise<{ workflowId: string; cacheToken?: string; status: string }> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp/discover`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to start discovery' }));
      throw new Error(error.message || 'Failed to start MCP discovery');
    }

    return response.json();
  },

  /**
   * Get the status of a discovery workflow
   */
  async getStatus(workflowId: string): Promise<DiscoveryStatus> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp/discover/${workflowId}`, {
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to get discovery status' }));
      throw new Error(error.message || 'Failed to fetch discovery status');
    }

    return response.json();
  },
};
