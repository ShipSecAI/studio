import { api } from '@/services/api';
import type { components } from '../../../packages/backend-client/src/api-client';

// Types for MCP discovery workflow
export type DiscoveryInput = components['schemas']['DiscoveryInputDto'];
export type GroupDiscoveryInput = components['schemas']['GroupDiscoveryInputDto'];
type DiscoveryToolDto = NonNullable<components['schemas']['DiscoveryStatusDto']['tools']>[number];

export type McpToolResponse = Pick<DiscoveryToolDto, 'name' | 'description' | 'inputSchema'>;

export interface DiscoveryStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpToolResponse[];
  toolCount?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GroupDiscoveryResult {
  name: string;
  status: 'running' | 'completed' | 'failed';
  tools?: McpToolResponse[];
  toolCount?: number;
  error?: string;
  cacheToken?: string;
}

export interface GroupDiscoveryStatus {
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  results?: GroupDiscoveryResult[];
  error?: string;
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
    return api.mcpDiscovery.discover(input);
  },

  /**
   * Get the status of a discovery workflow
   */
  async getStatus(workflowId: string): Promise<DiscoveryStatus> {
    return api.mcpDiscovery.getStatus(workflowId);
  },

  async discoverGroup(
    input: GroupDiscoveryInput,
  ): Promise<{ workflowId: string; cacheTokens: Record<string, string>; status: string }> {
    return api.mcpDiscovery.discoverGroup(input);
  },

  async getGroupStatus(workflowId: string): Promise<GroupDiscoveryStatus> {
    return api.mcpDiscovery.getGroupStatus(workflowId);
  },
};
