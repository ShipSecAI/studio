import type { Page } from '@playwright/test';

export interface CacheEntry {
  key: string;
  status: string;
  fetchStatus: string;
  isStale: boolean;
  size: string;
  staleTime: number | undefined;
}

/**
 * Extract TanStack Query cache entries via the dev-mode window global.
 */
export async function getCacheEntries(page: Page): Promise<CacheEntry[]> {
  return page.evaluate(() => {
    const client = (window as any).__TANSTACK_QUERY_CLIENT__;
    if (!client) return [];
    return client
      .getQueryCache()
      .getAll()
      .map((q: any) => ({
        key: JSON.stringify(q.queryKey),
        status: q.state.status,
        fetchStatus: q.state.fetchStatus,
        isStale: q.isStale(),
        size: Array.isArray(q.state.data)
          ? `${q.state.data.length} items`
          : typeof q.state.data,
        staleTime: q.options?.staleTime,
      }));
  });
}

/**
 * Get ghost queries: queries that are pending but not actively fetching.
 * These indicate orphaned or misconfigured queries.
 */
export async function getGhostQueries(page: Page): Promise<CacheEntry[]> {
  const entries = await getCacheEntries(page);
  return entries.filter(
    (e) => e.status === 'pending' && e.fetchStatus === 'idle',
  );
}
