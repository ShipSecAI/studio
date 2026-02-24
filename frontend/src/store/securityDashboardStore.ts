import { create } from 'zustand';
import { api } from '@/services/api';

// --- Types ---

export interface FindingLifecycle {
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export interface SecurityFinding {
  _id: string;
  scanner: string;
  finding_hash: string;
  severity: string;
  status: string;
  title: string | null;
  description: string | null;
  region: string | null;
  asset_key: string | null;
  account_id: string | null;
  service_name: string | null;
  resource_tags: Record<string, string> | null;
  check_name: string | null;
  compliance: string[] | null;
  finding_types: string[] | null;
  remediationText: string | null;
  recommendationUrl: string | null;
  shipsec: {
    workflow_id: string;
    workflow_name: string;
    run_id: string;
    component_id: string;
  };
  '@timestamp': string;
}

export interface SecurityDashboardFilters {
  account: string | null;
  severity: string[];
  status: string[];
  region: string[];
  service: string[];
  tags: string[];
  compliance: string[];
  checkName: string[];
  search: string;
  from: string | null;
  to: string | null;
  page: number;
  sort: string;
  order: 'asc' | 'desc';
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface TimeSeriesBucket {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface SecurityDashboardState {
  filters: SecurityDashboardFilters;
  findings: SecurityFinding[];
  total: number;
  severityCounts: SeverityCounts;
  accounts: { key: string; doc_count: number }[];
  regions: { key: string; doc_count: number }[];
  services: { key: string; doc_count: number }[];
  tagKeys: { key: string; doc_count: number }[];
  complianceFrameworks: { key: string; doc_count: number }[];
  checkNames: { key: string; doc_count: number }[];
  statusCounts: { key: string; doc_count: number }[];
  timeSeries: TimeSeriesBucket[];
  findingsLoading: boolean;
  summaryLoading: boolean;
  timeSeriesLoading: boolean;
  error: string | null;
  selectedFinding: SecurityFinding | null;
  selectedFindingLoading: boolean;
  findingLifecycles: Record<string, FindingLifecycle>;
  findingLifecyclesLoading: boolean;
  selectedFindingLifecycle: FindingLifecycle | null;
  selectedFindingLifecycleLoading: boolean;
}

interface SecurityDashboardActions {
  setFilters: (filters: Partial<SecurityDashboardFilters>) => void;
  resetFilters: () => void;
  fetchAll: (signal?: AbortSignal, interval?: string) => Promise<void>;
  fetchFindings: (signal?: AbortSignal) => Promise<void>;
  fetchSummary: (signal?: AbortSignal) => Promise<void>;
  fetchTimeSeries: (signal?: AbortSignal, interval?: string) => Promise<void>;
  fetchFindingById: (docId: string) => Promise<void>;
  setSelectedFinding: (finding: SecurityFinding | null) => void;
  fetchFindingLifecycle: (findingHash: string) => Promise<void>;
  fetchBatchLifecycles: (findingHashes: string[]) => Promise<void>;
}

export type SecurityDashboardStore = SecurityDashboardState & SecurityDashboardActions;

// --- Constants ---

const PAGE_SIZE = 25;

const INITIAL_FILTERS: SecurityDashboardFilters = {
  account: null,
  severity: [],
  status: [],
  region: [],
  service: [],
  tags: [],
  compliance: [],
  checkName: [],
  search: '',
  from: null,
  to: null,
  page: 1,
  sort: '@timestamp',
  order: 'desc',
};

const INITIAL_SEVERITY_COUNTS: SeverityCounts = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
};

// --- Helpers ---

function buildBaseFilter(filters: SecurityDashboardFilters) {
  const must: Record<string, any>[] = [{ term: { 'scanner.keyword': 'prowler' } }];

  if (filters.search.trim()) {
    must.push({
      multi_match: {
        query: filters.search.trim(),
        fields: ['title', 'description'],
      },
    });
  }

  const filter: Record<string, any>[] = [];

  if (filters.account) {
    filter.push({ term: { 'account_id.keyword': filters.account } });
  }

  if (filters.severity.length > 0) {
    filter.push({ terms: { 'severity.keyword': filters.severity } });
  }

  if (filters.status.length > 0) {
    filter.push({ terms: { 'status.keyword': filters.status } });
  }

  if (filters.region.length > 0) {
    filter.push({ terms: { 'region.keyword': filters.region } });
  }

  if (filters.service.length > 0) {
    filter.push({ terms: { 'service_name.keyword': filters.service } });
  }

  if (filters.tags.length > 0) {
    // Filter by tag keys present in the resource_tags object
    for (const tagKey of filters.tags) {
      filter.push({ exists: { field: `resource_tags.${tagKey}` } });
    }
  }

  if (filters.compliance.length > 0) {
    filter.push({ terms: { 'compliance.keyword': filters.compliance } });
  }

  if (filters.checkName.length > 0) {
    filter.push({ terms: { 'check_name.keyword': filters.checkName } });
  }

  if (filters.from || filters.to) {
    const range: Record<string, any> = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    filter.push({ range: { '@timestamp': range } });
  }

  return { bool: { must, filter } };
}

function buildSort(filters: SecurityDashboardFilters): Record<string, any>[] {
  const field = filters.sort === '@timestamp' ? '@timestamp' : `${filters.sort}.keyword`;
  return [{ [field]: filters.order }];
}

// --- Request versioning (race condition guards) ---

let batchLifecycleVersion = 0;
let detailLifecycleVersion = 0;

// --- Store ---

export const useSecurityDashboardStore = create<SecurityDashboardStore>((set, get) => ({
  // State
  filters: { ...INITIAL_FILTERS },
  findings: [],
  total: 0,
  severityCounts: { ...INITIAL_SEVERITY_COUNTS },
  accounts: [],
  regions: [],
  services: [],
  tagKeys: [],
  complianceFrameworks: [],
  checkNames: [],
  statusCounts: [],
  timeSeries: [],
  findingsLoading: false,
  summaryLoading: false,
  timeSeriesLoading: false,
  error: null,
  selectedFinding: null,
  selectedFindingLoading: false,
  findingLifecycles: {},
  findingLifecyclesLoading: false,
  selectedFindingLifecycle: null,
  selectedFindingLifecycleLoading: false,

  // Actions
  setFilters: (partial) => {
    set((state) => ({
      filters: { ...state.filters, ...partial },
    }));
  },

  resetFilters: () => {
    set({ filters: { ...INITIAL_FILTERS } });
  },

  fetchAll: async (signal?: AbortSignal, interval?: string) => {
    const { fetchFindings, fetchSummary, fetchTimeSeries } = get();
    await Promise.all([
      fetchFindings(signal),
      fetchSummary(signal),
      fetchTimeSeries(signal, interval),
    ]);
  },

  fetchFindings: async (signal?: AbortSignal) => {
    const { filters } = get();
    set({ findingsLoading: true, error: null, findingLifecycles: {} });

    try {
      const result = await api.analytics.query({
        query: buildBaseFilter(filters),
        size: PAGE_SIZE,
        from: (filters.page - 1) * PAGE_SIZE,
        sort: buildSort(filters),
      });

      if (signal?.aborted) return;

      const findings: SecurityFinding[] = result.hits.map((hit) => ({
        _id: hit._id,
        scanner: hit._source.scanner ?? 'prowler',
        finding_hash: hit._source.finding_hash ?? '',
        severity: hit._source.severity ?? 'unknown',
        status: hit._source.status ?? 'UNKNOWN',
        title: hit._source.title ?? null,
        description: hit._source.description ?? null,
        region: hit._source.region ?? null,
        asset_key: hit._source.asset_key ?? null,
        account_id: hit._source.account_id ?? null,
        service_name: hit._source.service_name ?? null,
        resource_tags: hit._source.resource_tags ?? null,
        check_name: hit._source.check_name ?? null,
        compliance: hit._source.compliance ?? null,
        finding_types: hit._source.finding_types ?? null,
        remediationText: hit._source.remediationText ?? null,
        recommendationUrl: hit._source.recommendationUrl ?? null,
        shipsec: hit._source.shipsec ?? {
          workflow_id: hit._source.workflow_id ?? '',
          workflow_name: hit._source.workflow_name ?? '',
          run_id: hit._source.run_id ?? '',
          component_id: hit._source.component_id ?? '',
        },
        '@timestamp': hit._source['@timestamp'] ?? '',
      }));

      set({ findings, total: result.total, findingsLoading: false });

      // Fire batch lifecycle enrichment (non-blocking)
      const hashes = findings.map((f) => f.finding_hash).filter(Boolean);
      if (hashes.length > 0) {
        get().fetchBatchLifecycles(hashes);
      }
    } catch (_err) {
      if (signal?.aborted) return;
      const message = _err instanceof Error ? _err.message : 'Failed to fetch findings';
      set({ findingsLoading: false, error: message });
    }
  },

  fetchSummary: async (signal?: AbortSignal) => {
    const { filters } = get();
    set({ summaryLoading: true });

    try {
      const result = await api.analytics.query({
        query: buildBaseFilter(filters),
        size: 0,
        aggs: {
          severity_counts: { terms: { field: 'severity.keyword' } },
          accounts: { terms: { field: 'account_id.keyword', size: 50 } },
          regions: { terms: { field: 'region.keyword', size: 50 } },
          services: { terms: { field: 'service_name.keyword', size: 100 } },
          compliance_frameworks: { terms: { field: 'compliance.keyword', size: 50 } },
          check_names: { terms: { field: 'check_name.keyword', size: 200 } },
          status_counts: { terms: { field: 'status.keyword' } },
        },
      });

      if (signal?.aborted) return;

      const severityCounts = { ...INITIAL_SEVERITY_COUNTS };
      const sevBuckets = result.aggregations?.severity_counts?.buckets ?? [];
      for (const bucket of sevBuckets) {
        const key = bucket.key?.toLowerCase();
        if (key in severityCounts) {
          severityCounts[key as keyof SeverityCounts] = bucket.doc_count;
        }
      }

      set({
        severityCounts,
        accounts: result.aggregations?.accounts?.buckets ?? [],
        regions: result.aggregations?.regions?.buckets ?? [],
        services: result.aggregations?.services?.buckets ?? [],
        complianceFrameworks: result.aggregations?.compliance_frameworks?.buckets ?? [],
        checkNames: result.aggregations?.check_names?.buckets ?? [],
        statusCounts: result.aggregations?.status_counts?.buckets ?? [],
        summaryLoading: false,
      });
    } catch (_err) {
      if (signal?.aborted) return;
      set({ summaryLoading: false });
    }
  },

  fetchTimeSeries: async (signal?: AbortSignal, interval?: string) => {
    const { filters } = get();
    set({ timeSeriesLoading: true });

    const calendarInterval = interval ?? 'day';

    try {
      const result = await api.analytics.query({
        query: buildBaseFilter(filters),
        size: 0,
        aggs: {
          over_time: {
            date_histogram: { field: '@timestamp', calendar_interval: calendarInterval },
            aggs: {
              by_severity: { terms: { field: 'severity.keyword' } },
            },
          },
        },
      });

      if (signal?.aborted) return;

      const buckets = result.aggregations?.over_time?.buckets ?? [];
      const timeSeries: TimeSeriesBucket[] = buckets.map((bucket: any) => {
        const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const sev of bucket.by_severity?.buckets ?? []) {
          const key = sev.key?.toLowerCase();
          if (key in counts) {
            counts[key] = sev.doc_count;
          }
        }
        return {
          date: bucket.key_as_string ?? new Date(bucket.key).toISOString(),
          ...counts,
        };
      });

      set({ timeSeries, timeSeriesLoading: false });
    } catch (_err) {
      if (signal?.aborted) return;
      set({ timeSeriesLoading: false });
    }
  },

  fetchFindingById: async (docId: string) => {
    set({ selectedFindingLoading: true });

    try {
      const result = await api.analytics.query({
        query: { ids: { values: [docId] } },
        size: 1,
      });

      if (result.hits.length > 0) {
        const hit = result.hits[0];
        const finding: SecurityFinding = {
          _id: hit._id,
          scanner: hit._source.scanner ?? 'prowler',
          finding_hash: hit._source.finding_hash ?? '',
          severity: hit._source.severity ?? 'unknown',
          status: hit._source.status ?? 'UNKNOWN',
          title: hit._source.title ?? null,
          description: hit._source.description ?? null,
          region: hit._source.region ?? null,
          asset_key: hit._source.asset_key ?? null,
          account_id: hit._source.account_id ?? null,
          service_name: hit._source.service_name ?? null,
          resource_tags: hit._source.resource_tags ?? null,
          check_name: hit._source.check_name ?? null,
          compliance: hit._source.compliance ?? null,
          finding_types: hit._source.finding_types ?? null,
          remediationText: hit._source.remediationText ?? null,
          recommendationUrl: hit._source.recommendationUrl ?? null,
          shipsec: hit._source.shipsec ?? {
            workflow_id: hit._source.workflow_id ?? '',
            workflow_name: hit._source.workflow_name ?? '',
            run_id: hit._source.run_id ?? '',
            component_id: hit._source.component_id ?? '',
          },
          '@timestamp': hit._source['@timestamp'] ?? '',
        };
        set({ selectedFinding: finding, selectedFindingLoading: false });

        // Trigger lifecycle fetch for deep-linked findings
        if (finding.finding_hash) {
          get().fetchFindingLifecycle(finding.finding_hash);
        }
      } else {
        set({ selectedFinding: null, selectedFindingLoading: false });
      }
    } catch (_err) {
      set({ selectedFindingLoading: false });
    }
  },

  setSelectedFinding: (finding) => {
    // Bump version to discard any in-flight detail lifecycle response
    detailLifecycleVersion++;
    set({
      selectedFinding: finding,
      selectedFindingLifecycle: null,
      selectedFindingLifecycleLoading: false,
    });
  },

  fetchFindingLifecycle: async (findingHash: string) => {
    const version = ++detailLifecycleVersion;
    set({ selectedFindingLifecycleLoading: true, selectedFindingLifecycle: null });

    try {
      const result = await api.analytics.query({
        query: {
          bool: {
            filter: [{ term: { 'finding_hash.keyword': findingHash } }],
          },
        },
        size: 0,
        aggs: {
          first_seen: { min: { field: '@timestamp' } },
          last_seen: { max: { field: '@timestamp' } },
        },
      });

      // Discard stale response if a newer request was issued
      if (version !== detailLifecycleVersion) return;

      const firstSeen = result.aggregations?.first_seen?.value_as_string;
      const lastSeen = result.aggregations?.last_seen?.value_as_string;
      const occurrences = result.total;

      if (firstSeen && lastSeen) {
        set({
          selectedFindingLifecycle: { firstSeen, lastSeen, occurrences },
          selectedFindingLifecycleLoading: false,
        });
      } else {
        set({ selectedFindingLifecycle: null, selectedFindingLifecycleLoading: false });
      }
    } catch {
      if (version !== detailLifecycleVersion) return;
      set({ selectedFindingLifecycleLoading: false });
    }
  },

  fetchBatchLifecycles: async (findingHashes: string[]) => {
    if (findingHashes.length === 0) return;

    const version = ++batchLifecycleVersion;
    const uniqueHashes = [...new Set(findingHashes)];
    set({ findingLifecyclesLoading: true });

    try {
      const result = await api.analytics.query({
        query: {
          bool: {
            filter: [{ terms: { 'finding_hash.keyword': uniqueHashes } }],
          },
        },
        size: 0,
        aggs: {
          by_hash: {
            terms: {
              field: 'finding_hash.keyword',
              size: uniqueHashes.length,
            },
            aggs: {
              first_seen: { min: { field: '@timestamp' } },
              last_seen: { max: { field: '@timestamp' } },
            },
          },
        },
      });

      // Discard stale response if a newer batch request was issued
      if (version !== batchLifecycleVersion) return;

      const lifecycles: Record<string, FindingLifecycle> = {};
      const buckets = result.aggregations?.by_hash?.buckets ?? [];
      for (const bucket of buckets) {
        lifecycles[bucket.key] = {
          firstSeen: bucket.first_seen?.value_as_string ?? '',
          lastSeen: bucket.last_seen?.value_as_string ?? '',
          occurrences: bucket.doc_count ?? 0,
        };
      }

      set({ findingLifecycles: lifecycles, findingLifecyclesLoading: false });
    } catch {
      if (version !== batchLifecycleVersion) return;
      set({ findingLifecyclesLoading: false });
    }
  },
}));

export const resetSecurityDashboardState = () => {
  useSecurityDashboardStore.setState({
    filters: { ...INITIAL_FILTERS },
    findings: [],
    total: 0,
    severityCounts: { ...INITIAL_SEVERITY_COUNTS },
    accounts: [],
    regions: [],
    services: [],
    tagKeys: [],
    complianceFrameworks: [],
    checkNames: [],
    statusCounts: [],
    timeSeries: [],
    findingsLoading: false,
    summaryLoading: false,
    timeSeriesLoading: false,
    error: null,
    selectedFinding: null,
    selectedFindingLoading: false,
    findingLifecycles: {},
    findingLifecyclesLoading: false,
    selectedFindingLifecycle: null,
    selectedFindingLifecycleLoading: false,
  });
};
