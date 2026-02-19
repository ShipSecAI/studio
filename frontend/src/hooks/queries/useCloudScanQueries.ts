import { useMemo } from 'react';
import { useQuery, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useGitHubStore } from '@/store/githubStore';
import { normalizeRunSummary } from '@/features/workflow-builder/utils/executionRuns';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { ExecutionStatus } from '@/schemas/execution';

// ── Constants ────────────────────────────────────────────────────────────────

const CLOUD_TEMPLATE_SLUGS = new Set(['sys-cloud-security-scan', 'sys-container-image-scan']);

const PAGE_LIMIT = 100;

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

export function useCloudScans(filters: CloudScansFilters = {}) {
  const { cloudWorkflowIds } = useCloudWorkflowIds();
  const status = filters.status || undefined;
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? PAGE_LIMIT;

  const queryKeyFilters = { status, offset, limit };

  return useQuery({
    queryKey: queryKeys.cloud.scans(queryKeyFilters),
    queryFn:
      cloudWorkflowIds.size === 0
        ? skipToken
        : async (): Promise<CloudScansData> => {
            const response = await api.executions.listRuns({
              limit,
              offset,
              status,
            });
            const rawRuns = response.runs ?? [];
            const allNormalized = rawRuns.map(normalizeRunSummary);

            // Client-side filter: only cloud workflow runs
            const cloudRuns = allNormalized.filter((r) => cloudWorkflowIds.has(r.workflowId));

            const liveCount = cloudRuns.filter((r) => LIVE_STATUSES.has(r.status)).length;

            const completedRuns = cloudRuns.filter(
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
              runs: cloudRuns,
              liveCount,
              successRate,
              totalFetched: rawRuns.length,
            };
          },
    staleTime: 30_000,
    refetchInterval: (query) => ((query.state.data?.liveCount ?? 0) > 0 ? 10_000 : false),
  });
}

export { useCloudWorkflowIds };
