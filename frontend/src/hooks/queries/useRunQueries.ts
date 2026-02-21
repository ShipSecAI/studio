import { useQuery, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import type { ExecutionStatus } from '@/schemas/execution';
import {
  TERMINAL_STATUSES,
  type ExecutionTriggerType,
  type ExecutionInputPreview,
} from '@shipsec/shared';

export interface ExecutionRun {
  id: string;
  workflowId: string;
  organizationId?: string;
  workflowName: string;
  status: ExecutionStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  nodeCount: number;
  eventCount: number;
  createdAt: string;
  isLive: boolean;
  workflowVersionId: string | null;
  workflowVersion: number | null;
  triggerType: ExecutionTriggerType;
  triggerSource: string | null;
  triggerLabel: string | null;
  inputPreview: ExecutionInputPreview;
  parentRunId?: string | null;
  parentNodeRef?: string | null;
}

const INITIAL_LIMIT = 5;
const LOAD_MORE_LIMIT = 20;

const TRIGGER_LABELS: Record<ExecutionTriggerType, string> = {
  manual: 'Manual run',
  schedule: 'Scheduled run',
  api: 'API run',
  webhook: 'Webhook trigger',
};

const normalizeRun = (run: any): ExecutionRun => {
  const startTime = typeof run.startTime === 'string' ? run.startTime : new Date().toISOString();
  const rawEndTime = typeof run.endTime === 'string' ? run.endTime : undefined;
  const status = (
    typeof run.status === 'string' ? run.status.toUpperCase() : 'FAILED'
  ) as ExecutionStatus;
  const isActiveStatus = !TERMINAL_STATUSES.includes(status);

  const derivedDuration =
    typeof run.duration === 'number'
      ? run.duration
      : rawEndTime && !isActiveStatus
        ? new Date(rawEndTime).getTime() - new Date(startTime).getTime()
        : Math.max(0, Date.now() - new Date(startTime).getTime());

  const triggerType = (run.triggerType as ExecutionTriggerType) ?? 'manual';
  const triggerLabelRaw = typeof run.triggerLabel === 'string' ? run.triggerLabel.trim() : '';

  return {
    id: String(run.id ?? ''),
    workflowId: String(run.workflowId ?? ''),
    organizationId: typeof run.organizationId === 'string' ? run.organizationId : undefined,
    workflowName: String(run.workflowName ?? 'Untitled workflow'),
    status,
    startTime,
    endTime: rawEndTime,
    duration: Number.isFinite(derivedDuration) ? derivedDuration : undefined,
    nodeCount: typeof run.nodeCount === 'number' ? run.nodeCount : 0,
    eventCount: typeof run.eventCount === 'number' ? run.eventCount : 0,
    createdAt: startTime,
    isLive: isActiveStatus,
    workflowVersionId: typeof run.workflowVersionId === 'string' ? run.workflowVersionId : null,
    workflowVersion: typeof run.workflowVersion === 'number' ? run.workflowVersion : null,
    triggerType,
    triggerSource: typeof run.triggerSource === 'string' ? run.triggerSource : null,
    triggerLabel: triggerLabelRaw.length > 0 ? triggerLabelRaw : TRIGGER_LABELS[triggerType],
    inputPreview: (run.inputPreview as ExecutionInputPreview) ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    },
    parentRunId: typeof run.parentRunId === 'string' ? run.parentRunId : null,
    parentNodeRef: typeof run.parentNodeRef === 'string' ? run.parentNodeRef : null,
  };
};

const sortRuns = (runs: ExecutionRun[]): ExecutionRun[] =>
  [...runs].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

interface RunsPage {
  runs: ExecutionRun[];
  hasMore: boolean;
}

export function useWorkflowRuns(workflowId: string | null | undefined) {
  const isEnabled = !!workflowId && workflowId !== 'new';

  return useQuery({
    queryKey: queryKeys.runs.byWorkflow(workflowId ?? ''),
    ...(isEnabled ? {} : { gcTime: 0 }),
    queryFn: isEnabled
      ? async (): Promise<RunsPage> => {
          // On refetch (e.g. polling), preserve the number of runs already loaded
          // so that "Load more" results aren't lost when the query is invalidated.
          const qk = queryKeys.runs.byWorkflow(workflowId);
          const existing = queryClient.getQueryData<RunsPage>(qk);
          const limit = existing ? Math.max(INITIAL_LIMIT, existing.runs.length) : INITIAL_LIMIT;
          const response = await api.executions.listRuns({
            limit,
            workflowId,
          });
          const rawRuns = response.runs ?? [];
          return {
            runs: sortRuns(rawRuns.map(normalizeRun)),
            hasMore: rawRuns.length >= limit,
          };
        }
      : skipToken,
    staleTime: 30_000,
  });
}

export async function fetchMoreRuns(workflowId: string | null | undefined) {
  const queryKey = workflowId ? queryKeys.runs.byWorkflow(workflowId) : queryKeys.runs.global();

  const existing = queryClient.getQueryData<RunsPage>(queryKey);
  if (!existing || !existing.hasMore) return;

  const offset = existing.runs.length;
  const response = await api.executions.listRuns({
    limit: LOAD_MORE_LIMIT,
    offset,
    workflowId: workflowId ?? undefined,
  });
  const rawRuns = response.runs ?? [];
  const normalized = rawRuns.map(normalizeRun);

  queryClient.setQueryData<RunsPage>(queryKey, (old) => {
    if (!old) return { runs: sortRuns(normalized), hasMore: rawRuns.length >= LOAD_MORE_LIMIT };
    const existingIds = new Set(old.runs.map((r: ExecutionRun) => r.id));
    const newRuns = normalized.filter((r: ExecutionRun) => !existingIds.has(r.id));
    return {
      runs: sortRuns([...old.runs, ...newRuns]),
      hasMore: rawRuns.length >= LOAD_MORE_LIMIT,
    };
  });
}

/** Upsert a single run into all matching cache entries */
export function upsertRunInCache(run: ExecutionRun) {
  const upsert = (old: RunsPage | undefined): RunsPage => {
    if (!old) return { runs: [run], hasMore: false };
    const existingIndex = old.runs.findIndex((r) => r.id === run.id);
    if (existingIndex === -1) {
      return { ...old, runs: sortRuns([...old.runs, run]) };
    }
    const updated = [...old.runs];
    updated[existingIndex] = { ...updated[existingIndex], ...run, status: run.status };
    return { ...old, runs: sortRuns(updated) };
  };

  // Update workflow-scoped cache
  const wfKey = queryKeys.runs.byWorkflow(run.workflowId);
  if (queryClient.getQueryData(wfKey)) {
    queryClient.setQueryData<RunsPage>(wfKey, upsert);
  }

  // Update global cache
  const globalKey = queryKeys.runs.global();
  if (queryClient.getQueryData(globalKey)) {
    queryClient.setQueryData<RunsPage>(globalKey, upsert);
  }

  // Update detail cache
  queryClient.setQueryData(queryKeys.runs.detail(run.id), run);
}

/** Invalidate all run queries for a workflow */
export function invalidateRunsForWorkflow(workflowId: string) {
  queryClient.invalidateQueries({ queryKey: queryKeys.runs.byWorkflow(workflowId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.runs.global() });
}

/**
 * Returns Infinity if the run is in a terminal state (cached), otherwise defaultMs.
 * Searches both detail cache AND list caches via getRunByIdFromCache.
 */
export function terminalStaleTime(runId: string | null | undefined, defaultMs: number): number {
  if (!runId) return defaultMs;
  const cached = getRunByIdFromCache(runId);
  if (cached && TERMINAL_STATUSES.includes(cached.status)) return Infinity;
  return defaultMs;
}

/** Get a run by ID from any cache entry */
export function getRunByIdFromCache(runId: string): ExecutionRun | undefined {
  // Check detail cache first
  const detail = queryClient.getQueryData<ExecutionRun>(queryKeys.runs.detail(runId));
  if (detail) return detail;

  // Search through all run query caches
  const queries = queryClient.getQueriesData<RunsPage>({ queryKey: ['runs'] });
  for (const [, data] of queries) {
    const found = data?.runs?.find((r) => r.id === runId);
    if (found) return found;
  }
  return undefined;
}
