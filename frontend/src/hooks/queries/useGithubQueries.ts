import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL, getApiAuthHeaders } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  GitHubInstallation,
  GitHubRepo,
  TriggerRule,
  GitHubScanResult,
  CreateTriggerRuleInput,
} from '@/store/githubStore';

// ── Shared fetch helper ───────────────────────────────────────────

async function fetchWithHeaders(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getApiAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

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
    queryFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/status`);
      if (!response.ok) throw new Error('Failed to fetch GitHub status');
      const data = await response.json();
      return data as { configured: boolean; installUrl: string | null };
    },
    staleTime: 30_000,
  });
}

export function useGitHubInstallations() {
  return useQuery({
    queryKey: queryKeys.github.installations(),
    queryFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/installations`);
      if (!response.ok) throw new Error('Failed to fetch installations');
      return response.json() as Promise<GitHubInstallation[]>;
    },
    staleTime: 30_000,
  });
}

export function useGitHubRepositories() {
  return useQuery({
    queryKey: queryKeys.github.repositories(),
    queryFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos`);
      if (!response.ok) throw new Error('Failed to fetch repositories');
      return response.json() as Promise<GitHubRepo[]>;
    },
    staleTime: 30_000,
  });
}

export function useGitHubBranches(repoId: string) {
  return useQuery({
    queryKey: queryKeys.github.branches(repoId),
    queryFn: async () => {
      const response = await fetchWithHeaders(
        `${API_BASE_URL}/api/v1/github/repos/${repoId}/branches`,
      );
      if (!response.ok) throw new Error('Failed to fetch branches');
      return response.json() as Promise<{ name: string; isDefault: boolean }[]>;
    },
    enabled: Boolean(repoId),
    staleTime: 30_000,
  });
}

export function useTriggerRules() {
  return useQuery({
    queryKey: queryKeys.github.triggerRules(),
    queryFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers`);
      if (!response.ok) throw new Error('Failed to fetch trigger rules');
      return response.json() as Promise<TriggerRule[]>;
    },
    staleTime: 30_000,
  });
}

export function useGitHubScanResults(filters?: ScanFilters) {
  const limit = filters?.limit ?? 25;
  const offset = filters?.offset ?? 0;

  return useQuery({
    queryKey: queryKeys.github.scans(filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.repositoryId) params.set('repositoryId', filters.repositoryId);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.source) params.set('source', filters.source);
      if (filters?.scheduleId) params.set('scheduleId', filters.scheduleId);
      if (filters?.triggerRuleId) params.set('triggerRuleId', filters.triggerRuleId);
      params.set('limit', String(limit + 1));
      if (offset > 0) params.set('offset', String(offset));

      const url = `${API_BASE_URL}/api/v1/github/scans${params.toString() ? `?${params}` : ''}`;
      const response = await fetchWithHeaders(url);
      if (!response.ok) throw new Error('Failed to fetch scan results');
      const rows = (await response.json()) as GitHubScanResult[];
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
    queryFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/scans/${id}`);
      if (!response.ok) throw new Error('Failed to fetch scan result');
      return response.json() as Promise<GitHubScanResult>;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────

export function useSetupInstallation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (installationId: number) => {
      const response = await fetchWithHeaders(
        `${API_BASE_URL}/api/v1/github/installations/setup`,
        {
          method: 'POST',
          body: JSON.stringify({ installationId }),
        },
      );
      if (!response.ok) throw new Error('Failed to setup installation');
      return response.json() as Promise<GitHubInstallation>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.installations() });
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useToggleRepoScans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await fetchWithHeaders(
        `${API_BASE_URL}/api/v1/github/repos/${id}/scans`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok) throw new Error('Failed to update repository');
      return response.json() as Promise<GitHubRepo>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useSyncRepositories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos/sync`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to sync repositories');
      return response.json() as Promise<{ synced: number }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
    },
  });
}

export function useCreateTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTriggerRuleInput) => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Failed to create trigger rule');
      return response.json() as Promise<TriggerRule>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.triggerRules() });
    },
  });
}

export function useUpdateTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Partial<CreateTriggerRuleInput>;
    }) => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error('Failed to update trigger rule');
      return response.json() as Promise<TriggerRule>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.triggerRules() });
    },
  });
}

export function useDeleteTriggerRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete trigger rule');
    },
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

      const response = await fetchWithHeaders(
        `${API_BASE_URL}/api/v1/github/repos/${repoId}/scan`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = (errorData as { message?: string }).message || 'Failed to trigger scan';
        throw new Error(message);
      }

      const data = await response.json();
      return (data as { scanId: string }).scanId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.github.scans() });
    },
  });
}
