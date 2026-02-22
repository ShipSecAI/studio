import { useQuery, skipToken } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import {
  executionNodeIOOptions,
  executionResultOptions,
  executionRunOptions,
} from '@/lib/executionQueryOptions';
import { terminalStaleTime } from '@/hooks/queries/useRunQueries';
import { TERMINAL_STATUSES } from '@shipsec/shared';
import { api } from '@/services/api';
import type { ExecutionStatusResponse } from '@/schemas/execution';

export function useExecutionNodeIO(runId: string | null) {
  const isTerminal = runId ? terminalStaleTime(runId, 10_000) === Infinity : false;
  return useQuery({
    ...(runId ? executionNodeIOOptions(runId, isTerminal) : {}),
    queryKey: queryKeys.executions.nodeIO(runId ?? ''),
    queryFn: runId ? executionNodeIOOptions(runId, isTerminal).queryFn : skipToken,
    enabled: !!runId,
    ...(!runId && { gcTime: 0 }),
  });
}

export function useExecutionResult(runId: string | null) {
  const isTerminal = runId ? terminalStaleTime(runId, 30_000) === Infinity : false;
  return useQuery({
    ...(runId ? executionResultOptions(runId, isTerminal) : {}),
    queryKey: queryKeys.executions.result(runId ?? ''),
    queryFn: runId ? executionResultOptions(runId, isTerminal).queryFn : skipToken,
    enabled: !!runId,
    ...(!runId && { gcTime: 0 }),
  });
}

export function useExecutionRun(runId: string | null | undefined) {
  const isTerminal = runId ? terminalStaleTime(runId, 30_000) === Infinity : false;
  return useQuery({
    ...(runId ? executionRunOptions(runId, isTerminal) : {}),
    queryKey: queryKeys.executions.run(runId ?? ''),
    queryFn: runId ? executionRunOptions(runId, isTerminal).queryFn : skipToken,
    enabled: !!runId,
    ...(!runId && { gcTime: 0 }),
  });
}

export function useExecutionStatus(runId: string | null | undefined) {
  return useQuery<ExecutionStatusResponse>({
    queryKey: queryKeys.executions.status(runId ?? ''),
    queryFn: runId
      ? async () => {
          const status = await api.executions.getStatus(runId);
          if (!status) {
            throw new Error('Execution status payload missing');
          }
          return status as ExecutionStatusResponse;
        }
      : skipToken,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_STATUSES.includes(status)) {
        return false;
      }
      return runId ? 2000 : false;
    },
    ...(!runId && { gcTime: 0 }),
  });
}
