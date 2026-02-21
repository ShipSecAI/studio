import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { API_V1_URL } from '@/services/api';
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
      asmFetch<AsmDomain>('/domains', {
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

// ── Asset Queries ────────────────────────────────────────────────────────────

export function useAsmAssets(options?: {
  limit?: number;
  offset?: number;
  domainId?: string;
  type?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.domainId) params.set('domainId', options.domainId);
  if (options?.type) params.set('type', options.type);
  if (options?.search) params.set('search', options.search);
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.sortOrder) params.set('sortOrder', options.sortOrder);

  const filters = options ?? {};
  return useQuery({
    queryKey: queryKeys.asm.assets(filters),
    queryFn: () => asmFetch<{ assets: AsmAsset[]; total: number }>(`/assets?${params.toString()}`),
    staleTime: 30_000,
  });
}

export function useAsmAsset(id: string | null) {
  return useQuery({
    queryKey: queryKeys.asm.asset(id ?? ''),
    queryFn: () => asmFetch<AsmAsset>(`/assets/${id}`),
    enabled: !!id,
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
    queryFn: () => asmFetch<AsmStats>('/stats'),
    staleTime: 60_000,
  });
}
