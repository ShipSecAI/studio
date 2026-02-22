import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

function sanitizeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'UnknownError', message: String(error) };
}

function isExpectedError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isExpectedError(error)) return;
      console.error('[QueryError]', { queryKey: query.queryKey, ...sanitizeError(error) });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isExpectedError(error)) return;
      console.error('[MutationError]', sanitizeError(error));
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

// Expose queryClient on window in dev mode for Playwright test inspection
if (import.meta.env.DEV) {
  (window as any).__TANSTACK_QUERY_CLIENT__ = queryClient;
}
