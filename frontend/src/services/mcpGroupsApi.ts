import { api } from '@/services/api';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';
import type { components } from '../../../packages/backend-client/src/api-client';

type McpGroupBase = components['schemas']['McpGroupResponseDto'];
type McpGroupServerDto = components['schemas']['McpGroupServerResponseDto'];
type McpGroupTemplateDto = components['schemas']['GroupTemplateDto'];
type SupportedTransportType = 'http' | 'stdio';

export interface McpGroupResponse extends McpGroupBase {
  servers?: McpGroupServerResponse[];
}

export interface McpGroupServerResponse extends Omit<McpGroupServerDto, 'transportType'> {
  serverId: string;
  transportType: SupportedTransportType;
}

export interface McpGroupTemplateResponse extends Omit<McpGroupTemplateDto, 'servers'> {
  servers: (Omit<McpGroupTemplateDto['servers'][number], 'transportType'> & {
    transportType: SupportedTransportType;
  })[];
}

function normalizeTransportType(
  transportType:
    | McpGroupServerDto['transportType']
    | McpGroupTemplateDto['servers'][number]['transportType'],
): SupportedTransportType {
  return transportType === 'stdio' ? 'stdio' : 'http';
}

function normalizeGroupServer(server: McpGroupServerDto): McpGroupServerResponse {
  return {
    ...server,
    serverId: server.id,
    transportType: normalizeTransportType(server.transportType),
  };
}

function normalizeGroupTemplate(template: McpGroupTemplateDto): McpGroupTemplateResponse {
  return {
    ...template,
    servers: template.servers.map((server) => ({
      ...server,
      transportType: normalizeTransportType(server.transportType),
    })),
  };
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
    return api.mcpGroups.list();
  },

  /**
   * Fetch all MCP groups with their servers embedded (avoids N+1 queries)
   */
  async listGroupsWithServers(): Promise<McpGroupResponse[]> {
    const groups = (await api.mcpGroups.list({ includeServers: true })) as (McpGroupBase & {
      servers?: McpGroupServerDto[];
    })[];
    return groups.map((group) => {
      const { servers, ...rest } = group;
      return {
        ...rest,
        servers: servers?.map(normalizeGroupServer),
      };
    });
  },

  /**
   * Fetch available group templates
   */
  async listTemplates(): Promise<McpGroupTemplateResponse[]> {
    const templates = await api.mcpGroups.listTemplates();
    return templates.map(normalizeGroupTemplate);
  },

  /**
   * Fetch a specific group by ID
   */
  async getGroup(groupId: string): Promise<McpGroupResponse> {
    return api.mcpGroups.get(groupId);
  },

  /**
   * Fetch servers in a group with health status and tool counts
   */
  async getGroupServers(groupId: string): Promise<McpGroupServerResponse[]> {
    const data = await api.mcpGroups.getServers(groupId);
    return data.map(normalizeGroupServer);
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

    const data = (await response.json()) as {
      statuses?: Record<string, 'healthy' | 'unhealthy' | 'unknown'>;
    };
    return data.statuses ?? {};
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
    return api.mcpGroups.syncTemplates() as Promise<{
      syncedCount: number;
      createdCount: number;
      updatedCount: number;
      templates: string[];
    }>;
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
    return api.mcpGroups.importTemplate(slug, serverCacheTokens);
  },

  /**
   * Delete an imported group
   */
  async deleteGroup(groupId: string): Promise<void> {
    await api.mcpGroups.delete(groupId);
  },
};
