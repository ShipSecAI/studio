import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';

// Types matching backend DTOs
export interface McpGroupResponse {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  serverIds: string[];
  enabled: boolean;
  defaultDockerImage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpGroupServerResponse {
  id?: string;
  name?: string;
  serverId: string;
  serverName: string;
  description?: string | null;
  transportType: 'http' | 'stdio';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  enabled: boolean;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  toolCount: number;
  recommended?: boolean;
  defaultSelected?: boolean;
}

export interface McpGroupTemplateResponse {
  slug: string;
  name: string;
  description?: string | null;
  credentialContractName: string;
  credentialMapping?: Record<string, unknown> | null;
  defaultDockerImage: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  servers: {
    name: string;
    description?: string | null;
    transportType: 'http' | 'stdio';
    endpoint?: string | null;
    command?: string | null;
    args?: string[] | null;
    recommended: boolean;
    defaultSelected: boolean;
  }[];
  templateHash: string;
}

/**
 * MCP Groups API Service
 *
 * Provides methods to interact with MCP group endpoints.
 * Groups are predefined collections of MCP servers (e.g., AWS MCPs, GitHub MCPs).
 */
export const mcpGroupsApi = {
  /**
   * Fetch all MCP groups
   */
  async listGroups(): Promise<McpGroupResponse[]> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch groups' }));
      throw new Error(error.message || 'Failed to fetch MCP groups');
    }

    return response.json();
  },

  /**
   * Fetch available group templates
   */
  async listTemplates(): Promise<McpGroupTemplateResponse[]> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/templates`, {
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to fetch group templates' }));
      throw new Error(error.message || 'Failed to fetch group templates');
    }

    return response.json();
  },

  /**
   * Fetch a specific group by ID
   */
  async getGroup(groupId: string): Promise<McpGroupResponse> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/${groupId}`, {
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch group' }));
      throw new Error(error.message || 'Failed to fetch MCP group');
    }

    return response.json();
  },

  /**
   * Fetch servers in a group with health status and tool counts
   */
  async getGroupServers(groupId: string): Promise<McpGroupServerResponse[]> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/${groupId}/servers`, {
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to fetch group servers' }));
      throw new Error(error.message || 'Failed to fetch group servers');
    }

    const data = await response.json();
    return data.map((server: McpGroupServerResponse) => ({
      ...server,
      serverId: server.serverId ?? server.id ?? '',
      serverName: server.serverName ?? server.name ?? 'Server',
      endpoint: server.endpoint ?? null,
      command: server.command ?? null,
      args: server.args ?? null,
      toolCount: server.toolCount ?? 0,
      healthStatus:
        (server as any).healthStatus ??
        (server as any).lastHealthStatus ??
        server.healthStatus ??
        'unknown',
    }));
  },

  /**
   * Fetch health status for all servers in a group
   */
  async getGroupHealth(
    groupId: string,
  ): Promise<Record<string, 'healthy' | 'unhealthy' | 'unknown'>> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/${groupId}/health`, {
      headers,
    });

    if (!response.ok) {
      // Health check failures should not throw - return empty status
      console.warn('Failed to fetch group health status');
      return {};
    }

    const data = await response.json();
    return data.statuses || {};
  },

  /**
   * Sync group templates from code to database
   */
  async syncTemplates(): Promise<{
    syncedCount: number;
    createdCount: number;
    updatedCount: number;
    templates: string[];
  }> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/sync-templates`, {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to sync group templates' }));
      throw new Error(error.message || 'Failed to sync group templates');
    }

    return response.json();
  },

  /**
   * Import a specific group template
   * @param slug - The template slug to import
   * @param serverCacheTokens - Optional map of server name -> cacheToken from pre-discovery
   */
  async importTemplate(
    slug: string,
    serverCacheTokens?: Record<string, string>,
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; group: McpGroupResponse }> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/templates/${slug}/import`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ serverCacheTokens }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: 'Failed to import group template' }));
      throw new Error(error.message || 'Failed to import group template');
    }

    return response.json();
  },

  /**
   * Delete an imported group
   */
  async deleteGroup(groupId: string): Promise<void> {
    const headers = await getApiAuthHeaders();
    const response = await fetch(`${API_BASE_URL}/api/v1/mcp-groups/${groupId}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to delete group' }));
      throw new Error(error.message || 'Failed to delete group');
    }
  },
};
