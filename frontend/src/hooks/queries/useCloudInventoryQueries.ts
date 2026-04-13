import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CloudAsset {
  id: string;
  organizationId: string;
  integrationId: string;
  provider: string;
  accountIdentifier: string;
  assetType: string;
  externalId: string;
  name: string;
  region: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  firstDiscoveredAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAssetSummary {
  totalAssets: number;
  byType: { assetType: string; count: number }[];
  byRegion: { region: string; count: number }[];
  byStatus: { status: string; count: number }[];
}

export interface SyncRun {
  id: string;
  organizationId: string;
  integrationId: string;
  accountIdentifier: string | null;
  temporalWorkflowId?: string | null;
  temporalRunId?: string | null;
  status: string;
  assetsDiscovered: number | null;
  assetsCreated: number | null;
  assetsUpdated: number | null;
  assetsStale: number | null;
  coveredRegions: string[] | null;
  startedAt: string;
  completedAt: string | null;
  errors: { message: string; timestamp: string }[] | null;
  createdAt: string;
}

export interface TriggerCloudSyncResult {
  workflowId: string;
  runId: string;
}

// ── Asset Queries ────────────────────────────────────────────────────────────

export function useCloudAssets(options?: {
  limit?: number;
  offset?: number;
  assetType?: string;
  region?: string;
  status?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const filters = options ?? {};
  return useQuery<{ assets: CloudAsset[]; total: number; page?: number; limit?: number }>({
    queryKey: queryKeys.cloudInventory.assets(filters),
    queryFn: () =>
      api.cloudInventory.listAssets({
        ...options,
        status: (options?.status as 'active' | 'stale' | 'removed' | undefined) ?? undefined,
        sortBy:
          (options?.sortBy as 'name' | 'lastSeenAt' | 'firstDiscoveredAt' | undefined) ?? undefined,
      }) as Promise<{ assets: CloudAsset[]; total: number; page?: number; limit?: number }>,
    staleTime: 30_000,
  });
}

export function useCloudAsset(id: string | null) {
  return useQuery<CloudAsset>({
    queryKey: queryKeys.cloudInventory.asset(id ?? ''),
    queryFn: id ? () => api.cloudInventory.getAsset(id) as Promise<CloudAsset> : skipToken,
    staleTime: 30_000,
    ...(!id && { gcTime: 0 }),
  });
}

export function useCloudAssetSummary() {
  return useQuery<CloudAssetSummary>({
    queryKey: queryKeys.cloudInventory.summary(),
    queryFn: () => api.cloudInventory.getSummary() as Promise<CloudAssetSummary>,
    staleTime: 60_000,
  });
}

// ── Sync Run Queries ─────────────────────────────────────────────────────────

export function useCloudSyncRuns(options?: { limit?: number; offset?: number }) {
  const filters = options ?? {};
  return useQuery<{ syncRuns: SyncRun[]; total: number; page?: number; limit?: number }>({
    queryKey: queryKeys.cloudInventory.syncRuns(filters),
    queryFn: () =>
      api.cloudInventory.listSyncRuns(options) as Promise<{
        syncRuns: SyncRun[];
        total: number;
        page?: number;
        limit?: number;
      }>,
    staleTime: 30_000,
  });
}

export function useCloudSyncRun(id: string | null) {
  return useQuery<SyncRun>({
    queryKey: queryKeys.cloudInventory.syncRun(id ?? ''),
    queryFn: id ? () => api.cloudInventory.getSyncRun(id) as Promise<SyncRun> : skipToken,
    staleTime: 30_000,
    ...(!id && { gcTime: 0 }),
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useTriggerCloudSync() {
  const queryClient = useQueryClient();
  return useMutation<TriggerCloudSyncResult, Error, string>({
    mutationFn: (integrationId: string) =>
      api.cloudInventory.triggerSync(integrationId) as Promise<TriggerCloudSyncResult>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.syncRuns() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.assets() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.summary() });
    },
  });
}
