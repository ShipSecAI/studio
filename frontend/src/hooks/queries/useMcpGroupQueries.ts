import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpGroupsApi } from '@/services/mcpGroupsApi';
import { queryKeys } from '@/lib/queryKeys';

export function useMcpGroups() {
  return useQuery({
    queryKey: queryKeys.mcpGroups.all(),
    queryFn: () => mcpGroupsApi.listGroups(),
    staleTime: 30_000,
  });
}

/** Fetch groups with embedded servers — avoids N+1 per-group server queries */
export function useMcpGroupsWithServers() {
  return useQuery({
    queryKey: [...queryKeys.mcpGroups.all(), 'withServers'] as const,
    queryFn: () => mcpGroupsApi.listGroupsWithServers(),
    staleTime: 30_000,
  });
}

export function useMcpGroupServers(groupId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mcpGroups.servers(groupId!),
    queryFn: () => mcpGroupsApi.getGroupServers(groupId!),
    enabled: !!groupId,
    staleTime: 30_000,
  });
}

export function useDeleteMcpGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => mcpGroupsApi.deleteGroup(groupId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
    },
  });
}

export function useImportMcpGroupTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      serverCacheTokens,
    }: {
      slug: string;
      serverCacheTokens?: Record<string, string>;
    }) => mcpGroupsApi.importTemplate(slug, serverCacheTokens),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
      qc.invalidateQueries({ queryKey: queryKeys.mcpGroups.templates() });
    },
  });
}

export function useMcpGroupTemplates() {
  return useQuery({
    queryKey: queryKeys.mcpGroups.templates(),
    queryFn: () => mcpGroupsApi.listTemplates(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSyncMcpGroupTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => mcpGroupsApi.syncTemplates(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.mcpGroups.templates() });
    },
  });
}
