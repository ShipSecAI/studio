import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateMcpServer, UpdateMcpServer } from '@shipsec/shared';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import { queryKeys } from '@/lib/queryKeys';

// Re-export types that consumers need
export interface McpServerResponse {
  id: string;
  name: string;
  description?: string | null;
  transportType: 'http' | 'stdio';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  hasHeaders: boolean;
  headerKeys?: string[] | null;
  enabled: boolean;
  healthCheckUrl?: string | null;
  lastHealthCheck?: string | null;
  lastHealthStatus?: import('@shipsec/shared').McpHealthStatus | null;
  createdAt: string;
  updatedAt: string;
  groupId?: string | null;
}

export interface McpToolResponse {
  id: string;
  toolName: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  serverId: string;
  serverName: string;
  enabled: boolean;
  discoveredAt: string;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getApiAuthHeaders();
  const { signal, ...restOptions } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...restOptions,
    signal,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function useMcpServers() {
  return useQuery({
    queryKey: queryKeys.mcpServers.all(),
    queryFn: () => apiRequest<McpServerResponse[]>('/api/v1/mcp-servers'),
    staleTime: 120_000,
  });
}

export function useMcpAllTools() {
  return useQuery({
    queryKey: queryKeys.mcpServers.tools(),
    queryFn: () => apiRequest<McpToolResponse[]>('/api/v1/mcp-servers/tools'),
    staleTime: 120_000,
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMcpServer) =>
      apiRequest<McpServerResponse>('/api/v1/mcp-servers', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMcpServer }) =>
      apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest(`/api/v1/mcp-servers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useToggleMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}/toggle`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useTestMcpConnection() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ success: boolean; message?: string; toolCount?: number }>(
        `/api/v1/mcp-servers/${id}/test`,
        { method: 'POST' },
      ),
  });
}

export function useFetchServerTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) =>
      apiRequest<McpToolResponse[]>(`/api/v1/mcp-servers/${serverId}/tools`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useToggleMcpTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, toolId }: { serverId: string; toolId: string }) =>
      apiRequest<McpToolResponse>(`/api/v1/mcp-servers/${serverId}/tools/${toolId}/toggle`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useDiscoverMcpTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serverId,
      servers,
      image,
    }: {
      serverId: string;
      servers: McpServerResponse[];
      image?: string;
    }) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) throw new Error(`Server ${serverId} not found`);

      const { workflowId } = await mcpDiscoveryApi.discover({
        transport: server.transportType,
        name: server.name,
        endpoint: server.endpoint ?? undefined,
        command: server.command ?? undefined,
        args: server.args ?? undefined,
        image,
      });

      const maxAttempts = 60;
      const pollInterval = 1000;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const status = await mcpDiscoveryApi.getStatus(workflowId);
        if (status.status === 'completed' && status.tools) {
          return status.tools.map((tool) => ({
            id: `${serverId}-${tool.name}`,
            toolName: tool.name,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema ?? null,
            serverId,
            serverName: server.name,
            enabled: true,
            discoveredAt: new Date().toISOString(),
          })) as McpToolResponse[];
        }
        if (status.status === 'failed') {
          throw new Error(status.error ?? 'Discovery failed');
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      throw new Error('Discovery timed out after 60 seconds');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}
