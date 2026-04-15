import { skipToken, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';

export function useBillingUsage() {
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
    queryKey: queryKeys.billing.usage(),
    queryFn: canFetch ? () => api.billing.getUsage() : skipToken,
    staleTime: 60_000,
    ...(canFetch ? {} : { gcTime: 0 }),
  });
}

export function useSubscriptionPlans() {
  return useQuery({
    queryKey: queryKeys.billing.plans(),
    queryFn: () => api.billing.getPlans(),
    staleTime: Infinity,
  });
}
