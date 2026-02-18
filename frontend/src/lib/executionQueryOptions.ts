import { queryOptions } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * queryOptions() factories for execution endpoints.
 *
 * Consumable by both React hooks (useQuery) and imperative code
 * (queryClient.fetchQuery) — same key = shared in-flight promise.
 *
 * NOTE: Logs are intentionally excluded. Log scrubbing produces moving
 * time windows that create high-cardinality keys with poor cache reuse.
 */

// --- Polling-backed (staleTime: 0, retry: false) ---

export const executionStatusOptions = (runId: string) =>
  queryOptions({
    queryKey: queryKeys.executions.status(runId),
    queryFn: () => api.executions.getStatus(runId),
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });

export const executionTraceOptions = (runId: string) =>
  queryOptions({
    queryKey: queryKeys.executions.trace(runId),
    queryFn: () => api.executions.getTrace(runId),
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });

// --- Timeline data (fetched once per loadTimeline, live updates via SSE) ---

export const executionEventsOptions = (runId: string) =>
  queryOptions({
    queryKey: queryKeys.executions.events(runId),
    queryFn: () => api.executions.getEvents(runId),
    staleTime: 5_000,
    gcTime: 30_000,
    retry: false,
  });

export const executionDataFlowsOptions = (runId: string) =>
  queryOptions({
    queryKey: queryKeys.executions.dataFlows(runId),
    queryFn: () => api.executions.getDataFlows(runId),
    staleTime: 5_000,
    gcTime: 30_000,
    retry: false,
  });

// --- On-demand, cacheable ---

export const executionTerminalChunksOptions = (runId: string, nodeRef: string, stream: string) =>
  queryOptions({
    queryKey: queryKeys.executions.terminalChunks(runId, nodeRef, stream),
    queryFn: () => api.executions.getTerminalChunks(runId, { nodeRef, stream }),
    staleTime: 10_000,
    gcTime: 30_000,
  });

export const executionNodeIOOptions = (runId: string, isTerminal?: boolean) =>
  queryOptions({
    queryKey: queryKeys.executions.nodeIO(runId),
    queryFn: () => api.executions.listNodeIO(runId),
    staleTime: isTerminal ? Infinity : 10_000,
    gcTime: isTerminal ? 10 * 60_000 : 30_000,
  });

export const executionResultOptions = (runId: string, isTerminal?: boolean) =>
  queryOptions({
    queryKey: queryKeys.executions.result(runId),
    queryFn: () => api.executions.getResult(runId),
    staleTime: isTerminal ? Infinity : 30_000,
    gcTime: isTerminal ? 10 * 60_000 : 30_000,
  });

export const executionRunOptions = (runId: string, isTerminal?: boolean) =>
  queryOptions({
    queryKey: queryKeys.executions.run(runId),
    queryFn: () => api.executions.getRun(runId),
    staleTime: isTerminal ? Infinity : 30_000,
    gcTime: isTerminal ? 10 * 60_000 : 30_000,
  });
