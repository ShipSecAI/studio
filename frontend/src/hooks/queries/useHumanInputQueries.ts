import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

interface HumanInputFilters {
  status?: 'pending' | 'resolved' | 'expired' | 'cancelled';
}

export function useHumanInputs(filters?: HumanInputFilters) {
  const apiFilters = { status: filters?.status };
  return useQuery({
    queryKey: queryKeys.humanInputs.all(apiFilters as Record<string, unknown>),
    queryFn: () => api.humanInputs.list(apiFilters),
    staleTime: 30_000,
  });
}

export function useInvalidateHumanInputs() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['humanInputs'] });
}
