import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  GitHubInstallation,
  GitHubRepo,
  TriggerRule,
  GitHubScanResult,
  CreateTriggerRuleInput,
} from '@/store/githubStore';

// ── Scan filter types ─────────────────────────────────────────────

export interface ScanFilters {
  repositoryId?: string;
  status?: string;
  source?: 'pr' | 'push' | 'manual' | 'schedule';
  scheduleId?: string;
  triggerRuleId?: string;
  limit?: number;
  offset?: number;
}

// ── Queries ───────────────────────────────────────────────────────

export function useGitHubStatus() {
  return useQuery({
    queryKey: queryKeys.github.status(),
    queryFn: () =>
      api.github.getStatus() as Promise<{ configured: boolean; installUrl: string | null }>,
    staleTime: 30_000,
  });
}

export function useGitHubInstallations() {
  return useQuery({
    queryKey: queryKeys.github.installations(),
    queryFn: () => api.github.listInstallations() as Promise<GitHubInstallation[]>,
    staleTime: 30_000,
  });
}

export function useGitHubRepositories() {
  return useQuery({
    queryKey: queryKeys.github.repositories(),
    queryFn: () => api.github.listRepositories() as Promise<GitHubRepo[]>,
    staleTime: 30_000,
  });
}

export function useGitHubBranches(repoId: string) {
  return useQuery({
    queryKey: queryKeys.github.branches(repoId),
    queryFn: repoId
      ? () => api.github.listBranches(repoId) as Promise<{ name: string; isDefault: boolean }[]>
      : skipToken,
    staleTime: 30_000,
  });
}

export function useTriggerRules() {
  return useQuery({
    queryKey: queryKeys.github.triggerRules(),
    queryFn: () => api.github.listTriggerRules() as Promise<TriggerRule[]>,
    staleTime: 30_000,
  });
}

export function useGitHubScanResults(filters?: ScanFilters) {
  const limit = filters?.limit ?? 25;
  const offset = filters?.offset ?? 0;

  return useQuery({
    queryKey: queryKeys.github.scans(filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const rows = (await api.github.listScans({
        repositoryId: filters?.repositoryId,
        status: filters?.status,
        source: filters?.source,
        scheduleId: filters?.scheduleId,
        triggerRuleId: filters?.triggerRuleId,
        limit: limit + 1,
        offset: offset > 0 ? offset : undefined,
      })) as GitHubScanResult[];
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      return { data, hasMore };
    },
    staleTime: 30_000,
  });
}

export function useGitHubScanResult(id: string) {
  return useQuery({
    queryKey: queryKeys.github.scan(id),
    queryFn: () => api.github.getScan(id) as Promise<GitHubScanResult>,
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────

export function useSetupInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: number) =>
      api.github.setupInstallation(installationId) as Promise<GitHubInstallation>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.installations() });
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useToggleRepoScans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.github.toggleRepoScans(id, enabled) as Promise<GitHubRepo>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useSyncRepositories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.github.syncRepositories() as Promise<{ synced: number }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useCreateTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTriggerRuleInput) =>
      api.github.createTriggerRule(input) as Promise<TriggerRule>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.triggerRules() });
    },
  });
}

export function useUpdateTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateTriggerRuleInput> }) =>
      api.github.updateTriggerRule(id, input) as Promise<TriggerRule>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.triggerRules() });
    },
  });
}

export function useDeleteTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.github.deleteTriggerRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.triggerRules() });
    },
  });
}

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      repoId,
      workflowId,
      branch,
    }: {
      repoId: string;
      workflowId: string;
      branch?: string;
    }) => {
      const body: { workflowId: string; branch?: string } = { workflowId };
      if (branch) body.branch = branch;

      return api.github.triggerScan(repoId, body) as Promise<{ scanId: string; runId: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.scans() });
    },
  });
}
