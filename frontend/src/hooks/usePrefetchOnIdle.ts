import { useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { fetchComponentIndex } from '@/hooks/queries/useComponentQueries';
import { useAuth } from '@/auth/useAuth';

/**
 * Prefetch commonly-needed data during browser idle time.
 * Place this once in AppLayout so data is warm before the user navigates.
 */
export function usePrefetchOnIdle() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    const prefetch = () => {
      // Components – used on almost every workflow page
      queryClient.prefetchQuery({
        queryKey: queryKeys.components.all(),
        queryFn: fetchComponentIndex,
        staleTime: Infinity,
        gcTime: Infinity,
      });

      // Workflows summary – used by schedules, webhooks, artifacts pages
      queryClient.prefetchQuery({
        queryKey: queryKeys.workflows.summary(),
        queryFn: () => api.workflows.listSummary(),
        staleTime: 60_000,
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch, { timeout: 5_000 });
      return () => window.cancelIdleCallback(id);
    }

    // Fallback for browsers without requestIdleCallback
    const timer = setTimeout(prefetch, 2_000);
    return () => clearTimeout(timer);
  }, [isAuthenticated]);
}
