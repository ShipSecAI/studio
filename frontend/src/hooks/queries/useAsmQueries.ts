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
      queryClient.invalidateQueries({ queryKey: ['asm'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asm'] });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.asm.deleteDomain(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asm'] });
    },
  });
}

export function useTriggerDomainScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domainId, templateSlug }: { domainId: string; templateSlug?: string }) => {
      return api.asm.triggerDomainScan(domainId, { templateSlug });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asm'] });
    },
  });
}

// ── Asset Queries (OpenSearch-backed) ────────────────────────────────────────

export interface AsmAssetHit {
  _id: string;
  scanner: string;
  scanner_labels?: string[];
  source_scanners?: string[];
  host: string;
  url?: string;
  ip?: string;
  status_code?: number;
  title?: string;
  webserver?: string;
  technologies?: string[];
  '@timestamp'?: string;
  [key: string]: unknown;
}

export function useAsmAssetsFromOpenSearch(filters: {
  scanner?: string[];
  search?: string;
  page?: number;
  domain?: string;
}) {
  return useQuery({
    queryKey: queryKeys.asm.assets(filters),
    queryFn: async () => {
      const must: Record<string, unknown>[] = [
        { terms: { 'scanner.keyword': filters.scanner ?? ['dnsx', 'httpx'] } },
      ];
      if (filters.search) {
        const escaped = filters.search.replace(/[*?\\]/g, '\\$&');
        must.push({ wildcard: { 'host.keyword': `*${escaped}*` } });
      }
      if (filters.domain) {
        must.push({ term: { 'shipsec.trigger_source.keyword': `asm:${filters.domain}` } });
      }

      const result = await api.analytics.query({
        query: { bool: { must } },
        size: 25,
        from: (filters.page ?? 0) * 25,
        sort: [{ '@timestamp': 'desc' }],
        collapse: { field: 'host.keyword' },
        aggs: {
          scanners: { terms: { field: 'scanner.keyword' } },
          unique_hosts: { cardinality: { field: 'host.keyword' } },
        },
      });

      return {
        hits: result.hits.map((h) => ({ _id: h._id, ...h._source })) as AsmAssetHit[],
        total: (result.aggregations?.unique_hosts as { value?: number })?.value ?? result.total,
        aggregations: result.aggregations,
      };
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
  return useQuery<{ runs: unknown[]; total?: number }>({
    queryKey: queryKeys.asm.scans(filters),
    queryFn: () => api.asm.listScans(options) as Promise<{ runs: unknown[]; total?: number }>,
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
        query: { bool: { must: [{ terms: { 'scanner.keyword': ['dnsx', 'httpx'] } }] } },
        size: 0,
        aggs: { unique_hosts: { cardinality: { field: 'host.keyword' } } },
      });
      return {
        domains: pgStats.domains,
        assets: (osResult.aggregations?.unique_hosts as { value?: number })?.value ?? 0,
      };
    },
    staleTime: 60_000,
  });
}
