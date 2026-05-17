import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import { queryKeys } from '@/lib/queryKeys';
import type { components } from '@shipsec/backend-client';

// Re-export types that consumers need
export type McpServerResponse = components['schemas']['McpServerResponseDto'];
export type McpServerTemplateResponse = components['schemas']['McpServerTemplateDto'];
export type ImportMcpServerTemplateInput = components['schemas']['ImportMcpServerTemplateDto'];
export type ImportMcpServerTemplateResponse =
  components['schemas']['ImportMcpServerTemplateResponseDto'];
export type McpToolResponse = components['schemas']['McpToolResponseDto'];
export type CreateMcpServer = components['schemas']['CreateMcpServerDto'];
export type UpdateMcpServer = components['schemas']['UpdateMcpServerDto'];

export function useMcpServers() {
  return useQuery({
    queryKey: queryKeys.mcpServers.all(),
    queryFn: () => api.mcpServers.list(),
    staleTime: 120_000,
  });
}

export function useMcpServerTemplates() {
  return useQuery({
    queryKey: queryKeys.mcpServers.templates(),
    queryFn: () => api.mcpServers.listTemplates(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useMcpAllTools() {
  return useQuery({
    queryKey: queryKeys.mcpServers.tools(),
    queryFn: () => api.mcpServers.listTools(),
    staleTime: 120_000,
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMcpServer) => api.mcpServers.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useImportMcpServerTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: ImportMcpServerTemplateInput }) =>
      api.mcpServers.importTemplate(slug, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.templates() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMcpServer }) =>
      api.mcpServers.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.mcpServers.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useToggleMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.mcpServers.toggle(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
    },
  });
}

export function useTestMcpConnection() {
  return useMutation({
    mutationFn: (id: string) => api.mcpServers.test(id),
  });
}

export function useFetchServerTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => api.mcpServers.listServerTools(serverId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
    },
  });
}

export function useToggleMcpTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, toolId }: { serverId: string; toolId: string }) =>
      api.mcpServers.toggleTool(serverId, toolId),
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
