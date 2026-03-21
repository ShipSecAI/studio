import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AsmDomain {
  id: string;
  organizationId: string;
  domain: string;
  scopeInclude: string[] | null;
  scopeExclude: string[] | null;
  monitoringEnabled: boolean;
  frequency: string | null;
  lastScanAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  techStack: string[];
}

export interface AsmAsset {
  id: string;
  organizationId: string;
  domainId: string;
  hostname: string;
  type: string;
  ipAddresses: string[] | null;
  techStack: string[] | null;
  ports: { port: number; protocol: string; service: string }[] | null;
  riskScore: string | null;
  dnsRecords: Record<string, unknown> | null;
  tlsInfo: Record<string, unknown> | null;
  firstSeen: string;
  lastSeen: string;
  metadata: Record<string, unknown> | null;
}

export interface AsmStats {
  domains: number;
  assets: number;
}

// ── Domain Queries ───────────────────────────────────────────────────────────

export function useAsmDomains(options?: { limit?: number; offset?: number }) {
  const filters = { limit: options?.limit ?? 50, offset: options?.offset ?? 0 };
  return useQuery<AsmDomain[]>({
    queryKey: queryKeys.asm.domains(filters),
    queryFn: () => api.asm.listDomains(filters) as Promise<AsmDomain[]>,
    staleTime: 30_000,
  });
}

export function useAsmDomain(id: string | null) {
  return useQuery<AsmDomain>({
    queryKey: queryKeys.asm.domain(id ?? ''),
    queryFn: id ? () => api.asm.getDomain(id) as Promise<AsmDomain> : skipToken,
    staleTime: 30_000,
    ...(!id && { gcTime: 0 }),
  });
}

export function useCreateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      domain: string;
      scopeInclude?: string[];
      scopeExclude?: string[];
      scanNow?: boolean;
    }) => api.asm.createDomain(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domainsAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.stats() });
    },
  });
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      scopeInclude?: string[];
      scopeExclude?: string[];
    }) => api.asm.updateDomain(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domain(variables.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domainsAll() });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.asm.deleteDomain(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domainsAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.stats() });
    },
  });
}

export function useTriggerDomainScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domainId, templateSlug }: { domainId: string; templateSlug?: string }) => {
      return api.asm.triggerDomainScan(domainId, { templateSlug });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domain(variables.domainId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.domainsAll() });
      queryClient.invalidateQueries({ queryKey: queryKeys.asm.scansAll() });
    },
  });
}

// ── Asset Queries (ClickHouse-backed) ────────────────────────────────────────

export interface AsmAssetHit {
  id: string;
  scanner: string;
  scanner_labels?: string[];
  source_scanners?: string[];
  host: string;
  url?: string;
  ip?: string;
  answers?: { a?: string[]; aaaa?: string[]; [key: string]: unknown };
  status_code?: number;
  title?: string;
  webserver?: string;
  technologies?: string[];
  timestamp?: string;
  [key: string]: unknown;
}

function normalizeAsmAssetHit(hit: Record<string, unknown>): AsmAssetHit {
  // Backend now spreads extra fields into the flat result via native JSON type
  const host = [hit.asset_key, hit.host].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  return {
    ...hit,
    host: host ?? '',
  } as AsmAssetHit;
}

export function transformAsmAssetsResponse(result: {
  total: number;
  results: Record<string, unknown>[];
  aggregations?: Record<string, { key: string; count: number }[]>;
  distinctCount?: number;
}) {
  return {
    hits: result.results.map(normalizeAsmAssetHit),
    total: result.distinctCount ?? result.total,
    aggregations: result.aggregations,
  };
}

export function useAsmAssets(filters: {
  scanner?: string[];
  search?: string;
  page?: number;
  domain?: string;
}) {
  return useQuery({
    queryKey: queryKeys.asm.assets(filters),
    queryFn: async () => {
      const queryFilters: { field: string; op: string; value?: unknown }[] = [
        { field: 'scanner', op: 'in', value: filters.scanner ?? ['dnsx', 'httpx'] },
      ];
      if (filters.search) {
        queryFilters.push({ field: 'asset_key', op: 'like', value: filters.search });
      }
      if (filters.domain) {
        queryFilters.push({ field: 'trigger_source', op: 'eq', value: `asm:${filters.domain}` });
      }

      const result = await api.analytics.query({
        filters: queryFilters,
        size: 25,
        from: (filters.page ?? 0) * 25,
        sort: [{ field: 'timestamp', direction: 'desc' }],
        distinct: 'asset_key',
        countDistinct: 'asset_key',
        aggs: [{ name: 'scanners', field: 'scanner' }],
      });

      return transformAsmAssetsResponse(result);
    },
    staleTime: 30_000,
  });
}

// ── Scan Queries ─────────────────────────────────────────────────────────────

export function useAsmScans(options?: {
  limit?: number;
  offset?: number;
  status?: string;
  domainId?: string;
}) {
  const filters = options ?? {};
  return useQuery({
    queryKey: queryKeys.asm.scans(filters),
    queryFn: () => api.asm.listScans(options),
    staleTime: 30_000,
  });
}

// ── Dashboard Stats ──────────────────────────────────────────────────────────

export function useAsmStats() {
  return useQuery({
    queryKey: queryKeys.asm.stats(),
    queryFn: async () => {
      const pgStats = await api.asm.getStats();
      const osResult = await api.analytics.query({
        filters: [{ field: 'scanner', op: 'in', value: ['dnsx', 'httpx'] }],
        size: 0,
        countDistinct: 'asset_key',
      });
      return {
        domains: pgStats.domains,
        assets: osResult.distinctCount ?? 0,
      };
    },
    staleTime: 60_000,
  });
}
