import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import type { components } from '@shipsec/backend-client';

type UpdateAnalyticsSettingsDto = components['schemas']['UpdateAnalyticsSettingsDto'];
type AnalyticsSettingsResponseDto = components['schemas']['AnalyticsSettingsResponseDto'];

function useCanFetch() {
  const provider = useAuthStore((s) => s.provider);
  const userId = useAuthStore((s) => s.userId);
  const token = useAuthStore((s) => s.token);
  const adminUsername = useAuthStore((s) => s.adminUsername);
  const adminPassword = useAuthStore((s) => s.adminPassword);

  return provider === 'local'
    ? Boolean(adminUsername && adminPassword)
    : Boolean(userId || (token && token.trim().length > 0));
}

export function useAnalyticsSettings() {
  const canFetch = useCanFetch();

  return useQuery<AnalyticsSettingsResponseDto>({
    queryKey: queryKeys.analyticsSettings.settings(),
    queryFn: canFetch ? () => api.analyticsSettings.getSettings() : skipToken,
    staleTime: 60_000,
    ...(canFetch ? {} : { gcTime: 0 }),
  });
}

export function useStorageUsage() {
  const canFetch = useCanFetch();

  return useQuery({
    queryKey: queryKeys.analyticsSettings.storageUsage(),
    queryFn: canFetch ? () => api.analyticsSettings.getStorageUsage() : skipToken,
    staleTime: 60_000,
    ...(canFetch ? {} : { gcTime: 0 }),
  });
}

export function useUpdateAnalyticsSettings() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateAnalyticsSettingsDto) => api.analyticsSettings.updateSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.analyticsSettings.settings() });
    },
  });
}

export function usePurgeAnalyticsData() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api.analyticsSettings.purgeData(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.analyticsSettings.settings() });
      qc.invalidateQueries({ queryKey: queryKeys.analyticsSettings.storageUsage() });
    },
  });
}
