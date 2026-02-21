import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { api, API_V1_URL } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { getFreshClerkToken } from '@/utils/clerk-token';

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const storeState = useAuthStore.getState();
  let token = storeState.token;
  const organizationId = storeState.provider === 'local' ? 'local-dev' : storeState.organizationId;

  if (storeState.provider === 'clerk') {
    try {
      const freshToken = await getFreshClerkToken();
      if (freshToken) {
        token = freshToken;
        storeState.setToken(freshToken);
      }
    } catch (_) {
      // Fall back to store token
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (organizationId) headers['x-organization-id'] = organizationId;
  headers['Content-Type'] = 'application/json';
  return headers;
}

async function asmFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_V1_URL}/asm${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `ASM API error: ${res.status}`);
  }
  return res.json();
}

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
  return useQuery({
    queryKey: queryKeys.asm.domains(filters),
    queryFn: () =>
      asmFetch<AsmDomain[]>(`/domains?limit=${filters.limit}&offset=${filters.offset}`),
    staleTime: 30_000,
  });
}

export function useAsmDomain(id: string | null) {
  return useQuery({
    queryKey: queryKeys.asm.domain(id ?? ''),
    queryFn: () => asmFetch<AsmDomain>(`/domains/${id}`),
    enabled: !!id,
    staleTime: 30_000,
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
    }) =>
      asmFetch<AsmDomain & { runId?: string; scanTriggered?: boolean }>('/domains', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
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
    }) =>
      asmFetch<AsmDomain>(`/domains/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asm'] });
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      asmFetch<{ success: boolean }>(`/domains/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asm'] });
    },
  });
}

export function useTriggerDomainScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ domainId, templateSlug }: { domainId: string; templateSlug?: string }) =>
      asmFetch<{ runId: string; domain: string }>(`/domains/${domainId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ templateSlug: templateSlug ?? 'sys-attack-surface-recon' }),
      }),
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
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.status) params.set('status', options.status);
  if (options?.domainId) params.set('domainId', options.domainId);

  const filters = options ?? {};
  return useQuery({
    queryKey: queryKeys.asm.scans(filters),
    queryFn: () => asmFetch<{ runs: unknown[]; total?: number }>(`/scans?${params.toString()}`),
    staleTime: 30_000,
  });
}

// ── Dashboard Stats ──────────────────────────────────────────────────────────

export function useAsmStats() {
  return useQuery({
    queryKey: queryKeys.asm.stats(),
    queryFn: async () => {
      const pgStats = await asmFetch<AsmStats>('/stats');
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
