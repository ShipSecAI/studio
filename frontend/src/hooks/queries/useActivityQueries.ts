import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { normalizeRun, type ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { ExecutionTriggerType } from '@shipsec/shared';
import { useToast } from '@/components/ui/use-toast';

export interface ActivityFilters {
  status?: string;
  triggerType?: ExecutionTriggerType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityItem extends ExecutionRun {
  detailHref: string;
}

const ACTIVITY_LIMIT = 25;

// "Running" tab includes all non-terminal active states
const RUNNING_STATUSES = ['RUNNING', 'QUEUED', 'AWAITING_INPUT'];

function toActivityItem(run: ExecutionRun): ActivityItem {
  return {
    ...run,
    detailHref: `/workflows/${run.workflowId}/runs/${run.id}`,
  };
}

export function useActivityRuns(filters: ActivityFilters = {}) {
  const limit = filters.limit ?? ACTIVITY_LIMIT;
  const offset = filters.offset ?? 0;

  // Map tab-level status to the actual API statuses
  const statusFilter = filters.status;
  const queryFilters = {
    status: statusFilter,
    triggerType: filters.triggerType,
    search: filters.search || undefined,
    limit,
    offset,
  };

  return useQuery({
    queryKey: queryKeys.runs.activity(queryFilters as Record<string, unknown>),
    queryFn: async () => {
      // For "Running" tab, we need to fetch multiple statuses and merge
      if (statusFilter === 'RUNNING') {
        const results = await Promise.all(
          RUNNING_STATUSES.map((s) =>
            api.executions.listRuns({
              ...queryFilters,
              status: s,
              limit: limit + offset,
              offset: 0,
            }),
          ),
        );
        const allRuns = results.flatMap((r) => r.runs ?? []);
        const normalized = allRuns
          .map(normalizeRun)
          .filter((r) => !r.parentRunId)
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        // Deduplicate
        const seen = new Set<string>();
        const unique = normalized.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        const paged = unique.slice(offset, offset + limit);
        return {
          items: paged.map(toActivityItem),
          hasMore: unique.length > offset + limit,
          hasLiveRuns: paged.some((r) => r.isLive),
        };
      }

      const response = await api.executions.listRuns({
        ...queryFilters,
        status: statusFilter || undefined,
      });
      const rawRuns = response.runs ?? [];
      const normalized = rawRuns.map(normalizeRun).filter((r) => !r.parentRunId);

      return {
        items: normalized.map(toActivityItem),
        hasMore: rawRuns.length >= limit,
        hasLiveRuns: normalized.some((r) => r.isLive),
      };
    },
    staleTime: 15_000,
    refetchInterval: (query) => {
      const hasLive = query.state.data?.hasLiveRuns;
      return hasLive ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (runId: string) => {
      return api.executions.cancel(runId);
    },
    onSuccess: () => {
      // Invalidate activity and global run caches
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (error: Error) => {
      const isForbidden = error.message.includes('403') || error.message.includes('Forbidden');
      toast({
        title: isForbidden ? 'Cannot stop run' : 'Failed to stop run',
        description: isForbidden ? 'System-triggered runs cannot be stopped.' : error.message,
        variant: 'destructive',
      });
    },
  });
}
