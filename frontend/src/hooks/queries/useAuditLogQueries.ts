import { skipToken, useInfiniteQuery } from '@tanstack/react-query';
import type { operations } from '../../../../packages/backend-client/src/client';

import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';

export type AuditLogFilters = Omit<
  NonNullable<operations['AuditLogsController_list']['parameters']['query']>,
  'cursor'
>;

export type AuditLogListResponse = Awaited<ReturnType<typeof api.auditLogs.list>>;
export type AuditLogEntry = AuditLogListResponse['items'][number];

export function useAuditLogs(filters: AuditLogFilters, canRead = true) {
  const limit = filters.limit ?? 50;
  const keyFilters = {
    resourceType: filters.resourceType,
    resourceId: filters.resourceId,
    action: filters.action,
    actorId: filters.actorId,
    from: filters.from,
    to: filters.to,
    limit,
  };

  return useInfiniteQuery({
    queryKey: queryKeys.auditLogs.all(keyFilters),
    queryFn: canRead
      ? ({ pageParam }) =>
          api.auditLogs.list({
            ...keyFilters,
            cursor: typeof pageParam === 'string' ? pageParam : undefined,
          })
      : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
