import { useMemo } from 'react';
import { useQuery, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useGitHubStore } from '@/store/githubStore';
import { normalizeRunSummary } from '@/features/workflow-builder/utils/executionRuns';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { ExecutionStatus } from '@/schemas/execution';
import {
  parseFinding,
  parseSeverityCounts,
  type SeverityCounts,
  type SecurityFinding,
} from '@/lib/securityQueryHelpers';

// ── Constants ────────────────────────────────────────────────────────────────

const CLOUD_TEMPLATE_SLUGS = new Set(['sys-cloud-security-scan', 'sys-container-image-scan']);

const PAGE_LIMIT = 100;
export const CLOUD_SCAN_FINDINGS_LIMIT = 200;

const LIVE_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'RUNNING', 'AWAITING_INPUT']);

// ── Internal: resolve cloud workflow IDs ─────────────────────────────────────

function useCloudWorkflowIds() {
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const systemWorkflowsLoading = useGitHubStore((s) => s.systemWorkflowsLoading);

  const cloudWorkflowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sw of systemWorkflows) {
      if (sw.slug && CLOUD_TEMPLATE_SLUGS.has(sw.slug)) {
        ids.add(sw.id);
      }
    }
    return ids;
  }, [systemWorkflows]);

  return { cloudWorkflowIds, systemWorkflowsLoading };
}

// ── Public hook ──────────────────────────────────────────────────────────────

export interface CloudScansFilters {
  status?: ExecutionStatus | '';
  offset?: number;
  limit?: number;
}

export interface CloudScansData {
  runs: ExecutionRun[];
  liveCount: number;
  successRate: number;
  totalFetched: number;
}

export interface CloudScanFindingsData {
  findings: SecurityFinding[];
  severityCounts: SeverityCounts;
  total: number;
  isTruncated: boolean;
}

export function transformCloudScanFindingsResponse(result: {
  total: number;
  results: Record<string, any>[];
  aggregations?: Record<string, { key: string; count: number }[]>;
}): CloudScanFindingsData {
  const findings = result.results.map(parseFinding);
  const severityCounts = parseSeverityCounts(result.aggregations?.severity_counts ?? []);
  const total = result.total ?? 0;
  const isTruncated = total > findings.length;

  return {
    findings,
    severityCounts,
    total,
    isTruncated,
  };
}

export function useCloudScans(filters: CloudScansFilters = {}) {
  const { cloudWorkflowIds } = useCloudWorkflowIds();
  const status = filters.status || undefined;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? PAGE_LIMIT;

  const queryKeyFilters = { status, offset, limit };

  // Pass workflowIds as CSV to the server for pre-filtered pagination
  const workflowIdsCSV = useMemo(() => {
    if (cloudWorkflowIds.size === 0) return '';
    return [...cloudWorkflowIds].join(',');
  }, [cloudWorkflowIds]);

  return useQuery({
    queryKey: queryKeys.cloud.scans({ ...queryKeyFilters, workflowIds: workflowIdsCSV }),
    queryFn:
      cloudWorkflowIds.size === 0
        ? skipToken
        : async (): Promise<CloudScansData> => {
            const response = await api.executions.listRuns({
              workflowIds: workflowIdsCSV,
              limit,
              offset,
              status,
            });
            const rawRuns = response.runs ?? [];
            const allNormalized = rawRuns.map(normalizeRunSummary);

            const liveCount = allNormalized.filter((r) => LIVE_STATUSES.has(r.status)).length;

            const completedRuns = allNormalized.filter(
              (r) => r.status === 'COMPLETED' || r.status === 'FAILED',
            );
            const successRate =
              completedRuns.length > 0
                ? Math.round(
                    (completedRuns.filter((r) => r.status === 'COMPLETED').length /
                      completedRuns.length) *
                      100,
                  )
                : 0;

            return {
              runs: allNormalized,
              liveCount,
              successRate,
              totalFetched: rawRuns.length,
            };
          },
    staleTime: 30_000,
    refetchInterval: (query) => ((query.state.data?.liveCount ?? 0) > 0 ? 10_000 : false),
  });
}

export interface SeveritySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export function useCloudScansSummaries(runIds: string[]) {
  const stableKey = useMemo(() => [...runIds].sort(), [runIds]);

  return useQuery({
    queryKey: queryKeys.cloud.scanSummaries(stableKey),
    queryFn:
      runIds.length === 0
        ? skipToken
        : async () => {
            const result = await api.analytics.batchRunSummaries(runIds);
            return result.summaries;
          },
    staleTime: 30_000,
  });
}

export function useCloudScanFindings(runId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.cloud.scanFindings(runId ?? ''),
    queryFn: runId
      ? async (): Promise<CloudScanFindingsData> => {
          const result = await api.analytics.query({
            filters: [{ field: 'run_id', op: 'eq', value: runId }],
            size: CLOUD_SCAN_FINDINGS_LIMIT,
            from: 0,
            sort: [
              { field: 'severity', direction: 'asc' },
              { field: 'timestamp', direction: 'desc' },
            ],
            aggs: [{ name: 'severity_counts', field: 'severity' }],
          });
          return transformCloudScanFindingsResponse(result);
        }
      : skipToken,
    staleTime: 30_000,
    ...(!runId && { gcTime: 0 }),
  });
}

export { useCloudWorkflowIds };
