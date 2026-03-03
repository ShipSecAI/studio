import { useQuery, skipToken, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { SecurityViewFilter } from '@/config/securityViews';
import {
  buildBaseFilter,
  buildSort,
  parseFinding,
  parseSeverityCounts,
  PAGE_SIZE,
  INITIAL_FILTERS,
  type SecurityDashboardFilters,
  type SecurityFinding,
  type SecurityFindingsResult,
  type FindingLifecycle,
  type TimeSeriesBucket,
  type SeverityCounts,
} from '@/lib/securityQueryHelpers';

// ── Findings + Summary (combined query) ─────────────────────────────

export function useSecurityFindings(
  filters: SecurityDashboardFilters,
  viewFilter: SecurityViewFilter,
) {
  return useQuery({
    queryKey: queryKeys.security.findings(filters, viewFilter),
    queryFn: async (): Promise<SecurityFindingsResult> => {
      const result = await api.analytics.query({
        query: buildBaseFilter(filters, viewFilter),
        size: PAGE_SIZE,
        from: (filters.page - 1) * PAGE_SIZE,
        sort: buildSort(filters),
        useLatest: true,
        aggs: {
          severity_counts: { terms: { field: 'severity' } },
          accounts: { terms: { field: 'account_id', size: 50 } },
          regions: { terms: { field: 'region', size: 50 } },
          services: { terms: { field: 'service_name', size: 100 } },
          compliance_frameworks: { terms: { field: 'compliance', size: 50 } },
          check_names: { terms: { field: 'check_name', size: 200 } },
          status_counts: { terms: { field: 'status' } },
          scanners: { terms: { field: 'scanner', size: 50 } },
          repositories: { terms: { field: 'shipsec.trigger_source', size: 100 } },
          rule_ids: { terms: { field: 'rule_id.keyword', size: 200 } },
          files: { terms: { field: 'file.keyword', size: 200 } },
        },
      });

      const findings = result.hits.map(parseFinding);
      const severityCounts = parseSeverityCounts(
        result.aggregations?.severity_counts?.buckets ?? [],
      );

      return {
        findings,
        total: result.total,
        summary: {
          severityCounts,
          accounts: result.aggregations?.accounts?.buckets ?? [],
          regions: result.aggregations?.regions?.buckets ?? [],
          services: result.aggregations?.services?.buckets ?? [],
          complianceFrameworks: result.aggregations?.compliance_frameworks?.buckets ?? [],
          checkNames: result.aggregations?.check_names?.buckets ?? [],
          statusCounts: result.aggregations?.status_counts?.buckets ?? [],
          scanners: result.aggregations?.scanners?.buckets ?? [],
          repositories: result.aggregations?.repositories?.buckets ?? [],
          ruleIds: result.aggregations?.rule_ids?.buckets ?? [],
          files: result.aggregations?.files?.buckets ?? [],
        },
      };
    },
    staleTime: 30_000,
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
}

// ── Time Series ─────────────────────────────────────────────────────

export function useSecurityTimeSeries(
  filters: SecurityDashboardFilters,
  viewFilter: SecurityViewFilter,
  interval = 'day',
  days = 30,
) {
  return useQuery({
    queryKey: queryKeys.security.timeSeries(filters, viewFilter, interval, days),
    queryFn: async (): Promise<TimeSeriesBucket[]> => {
      const now = new Date();
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const result = await api.analytics.query({
        query: buildBaseFilter(filters, viewFilter),
        size: 0,
        aggs: {
          over_time: {
            date_histogram: {
              field: '@timestamp',
              ...(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'].includes(interval)
                ? { calendar_interval: interval }
                : { fixed_interval: interval }),
              time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              min_doc_count: 0,
              extended_bounds: {
                min: cutoff.getTime(),
                max: now.getTime(),
              },
            },
            aggs: {
              by_severity: {
                terms: { field: 'severity' },
                aggs: {
                  unique_findings: { cardinality: { field: 'finding_hash' } },
                },
              },
            },
          },
        },
      });

      const buckets = result.aggregations?.over_time?.buckets ?? [];
      return buckets.map((bucket: any) => {
        const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        for (const sev of bucket.by_severity?.buckets ?? []) {
          const key = sev.key?.toLowerCase();
          if (key in counts) {
            counts[key] = sev.unique_findings?.value ?? sev.doc_count;
          }
        }
        return {
          date: bucket.key_as_string ?? new Date(bucket.key).toISOString(),
          ...counts,
        };
      }) as TimeSeriesBucket[];
    },
    staleTime: 30_000,
    refetchInterval: 20_000,
  });
}

// ── Heatmap Time Series (90-day window) ─────────────────────────────

export function useSecurityTimeSeriesForHeatmap(days = 90) {
  return useQuery({
    queryKey: queryKeys.security.timeSeriesHeatmap(days),
    queryFn: async (): Promise<TimeSeriesBucket[]> => {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - days * 86_400_000).toISOString();
      const filters: SecurityDashboardFilters = { ...INITIAL_FILTERS, from, to };

      const result = await api.analytics.query({
        query: buildBaseFilter(filters, {}),
        size: 0,
        aggs: {
          over_time: {
            date_histogram: {
              field: '@timestamp',
              calendar_interval: 'day',
              time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              min_doc_count: 0,
            },
            aggs: {
              by_severity: {
                terms: { field: 'severity' },
                aggs: {
                  unique_findings: { cardinality: { field: 'finding_hash' } },
                },
              },
            },
          },
        },
      });

      const buckets = result.aggregations?.over_time?.buckets ?? [];
      return buckets.map((bucket: any) => {
        const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        for (const sev of bucket.by_severity?.buckets ?? []) {
          const key = sev.key?.toLowerCase();
          if (key in counts) counts[key] = sev.unique_findings?.value ?? sev.doc_count;
        }
        return {
          date: bucket.key_as_string ?? new Date(bucket.key).toISOString(),
          ...counts,
        };
      }) as TimeSeriesBucket[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── Finding Detail ──────────────────────────────────────────────────

export function useFindingDetail(docId: string | null) {
  return useQuery({
    queryKey: queryKeys.security.findingDetail(docId ?? ''),
    queryFn: docId
      ? async (): Promise<SecurityFinding | null> => {
          const result = await api.analytics.query({
            query: { ids: { values: [docId] } },
            size: 1,
            useLatest: true,
          });
          if (result.hits.length > 0) {
            return parseFinding(result.hits[0]);
          }
          return null;
        }
      : skipToken,
    staleTime: 60_000,
  });
}

// ── Finding Lifecycle (single) ──────────────────────────────────────

export function useFindingLifecycle(hash: string | null) {
  return useQuery({
    queryKey: queryKeys.security.findingLifecycle(hash ?? ''),
    queryFn: hash
      ? async (): Promise<FindingLifecycle | null> => {
          const result = await api.analytics.query({
            query: {
              bool: {
                filter: [{ term: { finding_hash: hash } }],
              },
            },
            size: 0,
            aggs: {
              first_seen: { min: { field: '@timestamp' } },
              last_seen: { max: { field: '@timestamp' } },
            },
          });

          const firstSeen = result.aggregations?.first_seen?.value_as_string;
          const lastSeen = result.aggregations?.last_seen?.value_as_string;
          const occurrences = result.total;

          if (firstSeen && lastSeen) {
            return { firstSeen, lastSeen, occurrences };
          }
          return null;
        }
      : skipToken,
    staleTime: 60_000,
  });
}

// ── Batch Lifecycles ────────────────────────────────────────────────

export function useBatchLifecycles(hashes: string[]) {
  const uniqueHashes = [...new Set(hashes.filter(Boolean))];
  const sortedHashes = [...uniqueHashes].sort();

  return useQuery({
    queryKey: queryKeys.security.batchLifecycles(sortedHashes),
    queryFn:
      sortedHashes.length > 0
        ? async (): Promise<Record<string, FindingLifecycle>> => {
            const result = await api.analytics.query({
              query: {
                bool: {
                  filter: [{ terms: { finding_hash: uniqueHashes } }],
                },
              },
              size: 0,
              aggs: {
                by_hash: {
                  terms: {
                    field: 'finding_hash',
                    size: uniqueHashes.length,
                  },
                  aggs: {
                    first_seen: { min: { field: '@timestamp' } },
                    last_seen: { max: { field: '@timestamp' } },
                  },
                },
              },
            });

            const lifecycles: Record<string, FindingLifecycle> = {};
            const buckets = result.aggregations?.by_hash?.buckets ?? [];
            for (const bucket of buckets) {
              lifecycles[bucket.key] = {
                firstSeen: bucket.first_seen?.value_as_string ?? '',
                lastSeen: bucket.last_seen?.value_as_string ?? '',
                occurrences: bucket.doc_count ?? 0,
              };
            }
            return lifecycles;
          }
        : skipToken,
    staleTime: 30_000,
  });
}

// ── Category Counts (for HomePage) ──────────────────────────────────

interface CategoryCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export function useCategoryCounts(scannerToCategory: Record<string, string>, categories: string[]) {
  return useQuery({
    queryKey: queryKeys.security.categoryCounts(),
    queryFn: async (): Promise<Record<string, CategoryCounts>> => {
      const result = await api.analytics.query({
        query: {
          bool: {
            filter: [
              {
                bool: {
                  should: [
                    { term: { status: 'FAILED' } },
                    { bool: { must_not: [{ exists: { field: 'status' } }] } },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
        size: 0,
        useLatest: true,
        aggs: {
          by_scanner: {
            terms: { field: 'scanner', size: 20 },
            aggs: {
              by_severity: { terms: { field: 'severity' } },
            },
          },
        },
      });

      const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      const counts: Record<string, CategoryCounts> = {};
      for (const cat of categories) {
        counts[cat] = { ...emptyCounts };
      }

      const scannerBuckets = result.aggregations?.by_scanner?.buckets ?? [];
      for (const bucket of scannerBuckets) {
        const category = scannerToCategory[bucket.key];
        if (!category || !counts[category]) continue;
        for (const sev of bucket.by_severity?.buckets ?? []) {
          const key = sev.key?.toLowerCase() as keyof CategoryCounts;
          if (key in emptyCounts) {
            counts[category][key] += sev.doc_count;
          }
        }
      }
      return counts;
    },
    staleTime: 30_000,
    refetchInterval: 20_000,
  });
}

// ── New Finding Highlights ──────────────────────────────────────────

export function useNewFindingHighlights(currentFindings: SecurityFinding[] | undefined) {
  const [newFindingIds, setNewFindingIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!currentFindings || currentFindings.length === 0) {
      prevIdsRef.current = new Set();
      return;
    }

    const currentIds = new Set(currentFindings.map((f) => f._id));

    // On first load, just set the prev reference
    if (prevIdsRef.current.size === 0) {
      prevIdsRef.current = currentIds;
      return;
    }

    // Find IDs that are new since last poll
    const newIds = new Set<string>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) {
        newIds.add(id);
      }
    }

    prevIdsRef.current = currentIds;

    if (newIds.size > 0) {
      setNewFindingIds(newIds);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setNewFindingIds(new Set());
      }, 2000);
    }
  }, [currentFindings]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return newFindingIds;
}

// ── Prowler Checks Metadata ──────────────────────────────────────────

export function useProwlerChecksMetadata() {
  return useQuery({
    queryKey: queryKeys.security.prowlerChecksMetadata(),
    queryFn: () => api.analytics.prowlerChecksMetadata(),
    staleTime: Infinity,
  });
}

// Re-export types for consumers
export type {
  SecurityFinding,
  SecurityDashboardFilters,
  SeverityCounts,
  TimeSeriesBucket,
  FindingLifecycle,
};
