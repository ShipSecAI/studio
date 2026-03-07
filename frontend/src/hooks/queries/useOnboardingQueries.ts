import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '../../../../packages/backend-client/src/client';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

export function useOnboardingPreferences() {
  const provider = useAuthStore((s) => s.provider);
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const adminUsername = useAuthStore((s) => s.adminUsername);
  const adminPassword = useAuthStore((s) => s.adminPassword);
  const canFetch =
    provider === 'local'
      ? Boolean(adminUsername && adminPassword)
      : Boolean(userId || (token && token.trim().length > 0));

  return useQuery({
    queryKey: queryKeys.onboarding.preferences(),
    queryFn: canFetch ? () => api.onboarding.getPreferences() : skipToken,
    staleTime: 60_000,
    ...(canFetch ? {} : { gcTime: 0 }),
  });
}

export function useUpdateOnboardingPreferences() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (updates: components['schemas']['UpdateOnboardingPreferencesDto']) =>
      api.onboarding.updatePreferences(updates),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.onboarding.preferences(), data);
      qc.invalidateQueries({ queryKey: queryKeys.onboarding.preferences() });
    },
  });
}
