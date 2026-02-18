import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduleStatus } from '@shipsec/shared';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

type StatusFilter = ScheduleStatus | 'all';

interface ScheduleQueryFilters {
  workflowId?: string | null;
  status?: StatusFilter;
}

function buildApiFilters(filters?: ScheduleQueryFilters) {
  return {
    workflowId: filters?.workflowId ?? undefined,
    status:
      filters?.status && filters.status !== 'all' ? (filters.status as ScheduleStatus) : undefined,
  };
}

export function useSchedules(filters?: ScheduleQueryFilters) {
  const apiFilters = buildApiFilters(filters);
  return useQuery({
    queryKey: queryKeys.schedules.all(apiFilters as Record<string, unknown>),
    queryFn: () => api.schedules.list(apiFilters),
    staleTime: 60_000,
  });
}

export function usePauseSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.pause(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useResumeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.resume(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useRunSchedule() {
  return useMutation({
    mutationFn: (id: string) => api.schedules.runNow(id),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.schedules.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.schedules.create>[0]) =>
      api.schedules.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof api.schedules.update>[1];
    }) => api.schedules.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}
