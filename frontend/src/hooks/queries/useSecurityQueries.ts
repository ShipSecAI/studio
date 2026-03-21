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
  type AggBucket,
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
      const { filters: queryFilters, search } = buildBaseFilter(filters, viewFilter);
      const result = await api.analytics.query({
        filters: queryFilters,
        search,
        size: PAGE_SIZE,
        from: (filters.page - 1) * PAGE_SIZE,
        sort: buildSort(filters),
        useLatest: true,
        aggs: [
          { name: 'severity_counts', field: 'severity' },
          { name: 'accounts', field: 'account_id', size: 50 },
          { name: 'regions', field: 'region', size: 50 },
          { name: 'services', field: 'service_name', size: 100 },
          { name: 'compliance_frameworks', field: 'compliance', size: 50 },
          { name: 'check_names', field: 'check_name', size: 200 },
          { name: 'status_counts', field: 'status' },
          { name: 'scanners', field: 'scanner', size: 50 },
          { name: 'repositories', field: 'trigger_source', size: 100 },
          { name: 'rule_ids', field: 'rule_id', size: 200 },
          { name: 'files', field: 'file', size: 200 },
        ],
      });

      const findings = result.results.map(parseFinding);
      const aggregations = result.aggregations;
      const severityCounts = parseSeverityCounts(
        (aggregations?.severity_counts ?? []) as AggBucket[],
      );

      return {
        findings,
        total: result.total,
        summary: {
          severityCounts,
          accounts: (aggregations?.accounts ?? []) as AggBucket[],
          regions: (aggregations?.regions ?? []) as AggBucket[],
          services: (aggregations?.services ?? []) as AggBucket[],
          complianceFrameworks: (aggregations?.compliance_frameworks ?? []) as AggBucket[],
          checkNames: (aggregations?.check_names ?? []) as AggBucket[],
          statusCounts: (aggregations?.status_counts ?? []) as AggBucket[],
          scanners: (aggregations?.scanners ?? []) as AggBucket[],
          repositories: (aggregations?.repositories ?? []) as AggBucket[],
          ruleIds: (aggregations?.rule_ids ?? []) as AggBucket[],
          files: (aggregations?.files ?? []) as AggBucket[],
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
      const { filters: queryFilters } = buildBaseFilter(filters, viewFilter);

      const result = await api.analytics.timeSeries({
        filters: queryFilters,
        interval: interval as 'day' | 'week' | 'month',
        days,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Pivot { date, severity, count }[] into TimeSeriesBucket[]
      const dateMap: Record<string, Record<string, number>> = {};
      for (const b of result.buckets) {
        if (!dateMap[b.date]) {
          dateMap[b.date] = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        }
        const key = b.severity.toLowerCase();
        if (key in dateMap[b.date]) {
          dateMap[b.date][key] = b.count;
        }
      }

      return Object.entries(dateMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({
          date,
          ...counts,
        })) as TimeSeriesBucket[];
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

      const { filters: queryFilters } = buildBaseFilter(filters, {});

      const result = await api.analytics.timeSeries({
        filters: queryFilters,
        interval: 'day',
        days,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      const dateMap: Record<string, Record<string, number>> = {};
      for (const b of result.buckets) {
        if (!dateMap[b.date]) {
          dateMap[b.date] = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        }
        const key = b.severity.toLowerCase();
        if (key in dateMap[b.date]) {
          dateMap[b.date][key] = b.count;
        }
      }

      return Object.entries(dateMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({
          date,
          ...counts,
        })) as TimeSeriesBucket[];
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
            filters: [{ field: 'finding_hash', op: 'eq', value: docId }],
            size: 1,
            useLatest: true,
          });
          if (result.results.length > 0) {
            return parseFinding(result.results[0]);
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
          const result = await api.analytics.lifecycle({ hash });
          const lifecycle = result.lifecycles[hash];
          if (lifecycle) return lifecycle;
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
            const result = await api.analytics.lifecycle({ hashes: uniqueHashes });
            return result.lifecycles;
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
      const result = await api.analytics.scannerSeverityCounts({
        filters: [{ field: 'status', op: 'in', value: ['FAILED', ''] }],
        useLatest: true,
      });

      const emptyCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      const counts: Record<string, CategoryCounts> = {};
      for (const cat of categories) {
        counts[cat] = { ...emptyCounts };
      }

      for (const bucket of result.buckets) {
        const category = scannerToCategory[bucket.scanner];
        if (!category || !counts[category]) continue;

        const key = bucket.severity.toLowerCase() as keyof CategoryCounts;
        if (key in emptyCounts) {
          counts[category][key] += bucket.count;
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

    const currentIds = new Set(currentFindings.map((f) => f.id));

    if (prevIdsRef.current.size === 0) {
      prevIdsRef.current = currentIds;
      return;
    }

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
