import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';

// ── Fetch helper ────────────────────────────────────────────────────────────

async function inventoryFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await getApiAuthHeaders();
  headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_V1_URL}/asset-discovery${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Asset Discovery API error: ${res.status}`);
  }
  return res.json();
}

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
  accountIdentifier: string;
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
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.assetType) params.set('assetType', options.assetType);
  if (options?.region) params.set('region', options.region);
  if (options?.status) params.set('status', options.status);
  if (options?.search) params.set('search', options.search);
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.sortOrder) params.set('sortOrder', options.sortOrder);

  const filters = options ?? {};
  return useQuery({
    queryKey: queryKeys.cloudInventory.assets(filters),
    queryFn: () =>
      inventoryFetch<{ assets: CloudAsset[]; total: number }>(`/assets?${params.toString()}`),
    staleTime: 30_000,
  });
}

export function useCloudAsset(id: string | null) {
  return useQuery({
    queryKey: queryKeys.cloudInventory.asset(id ?? ''),
    queryFn: id ? () => inventoryFetch<CloudAsset>(`/assets/${id}`) : skipToken,
    staleTime: 30_000,
    ...(!id && { gcTime: 0 }),
  });
}

export function useCloudAssetSummary() {
  return useQuery({
    queryKey: queryKeys.cloudInventory.summary(),
    queryFn: () => inventoryFetch<CloudAssetSummary>('/assets/summary'),
    staleTime: 60_000,
  });
}

// ── Sync Run Queries ─────────────────────────────────────────────────────────

export function useCloudSyncRuns(options?: { limit?: number; offset?: number; status?: string }) {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.status) params.set('status', options.status);

  const filters = options ?? {};
  return useQuery({
    queryKey: queryKeys.cloudInventory.syncRuns(filters),
    queryFn: () =>
      inventoryFetch<{ syncRuns: SyncRun[]; total: number }>(`/sync-runs?${params.toString()}`),
    staleTime: 30_000,
  });
}

export function useCloudSyncRun(id: string | null) {
  return useQuery({
    queryKey: queryKeys.cloudInventory.syncRun(id ?? ''),
    queryFn: id ? () => inventoryFetch<SyncRun>(`/sync-runs/${id}`) : skipToken,
    staleTime: 30_000,
    ...(!id && { gcTime: 0 }),
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useTriggerCloudSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (integrationId: string) =>
      inventoryFetch<{ syncRunId: string; status: string }>('/assets/sync', {
        method: 'POST',
        body: JSON.stringify({ integrationId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.syncRuns() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.assets() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudInventory.summary() });
    },
  });
}
