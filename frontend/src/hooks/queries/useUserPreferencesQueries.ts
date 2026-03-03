import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

interface UserPreferences {
  hasCompletedOnboarding: boolean;
  hasCompletedBuilderTour: boolean;
}

export function useUserPreferences() {
  return useQuery({
    queryKey: queryKeys.userPreferences.me(),
    queryFn: () => api.userPreferences.get(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateUserPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Partial<UserPreferences>) => api.userPreferences.update(prefs),
    onMutate: async (newPrefs) => {
      await qc.cancelQueries({ queryKey: queryKeys.userPreferences.me() });
      const previous = qc.getQueryData<UserPreferences>(queryKeys.userPreferences.me());
      qc.setQueryData<UserPreferences>(queryKeys.userPreferences.me(), (old) => ({
        hasCompletedOnboarding: old?.hasCompletedOnboarding ?? false,
        hasCompletedBuilderTour: old?.hasCompletedBuilderTour ?? false,
        ...newPrefs,
      }));
      return { previous };
    },
    onError: (_err, _newPrefs, context) => {
      if (context?.previous) {
        qc.setQueryData(queryKeys.userPreferences.me(), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userPreferences.me() });
    },
  });
}
