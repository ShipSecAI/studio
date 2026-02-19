/**
 * Route chunk prefetching utility.
 *
 * Maps sidebar navigation paths to their dynamic import() calls (mirroring
 * the React.lazy definitions in App.tsx). This pre-downloads the JS chunks
 * so navigation feels instant.
 */

type PrefetchFn = () => void;

const routePrefetchMap: Record<string, PrefetchFn> = {
  '/': () => void import('@/pages/WorkflowList'),
  '/templates': () => void import('@/pages/TemplateLibraryPage'),
  '/schedules': () => void import('@/pages/SchedulesPage'),
  '/webhooks': () => void import('@/pages/WebhooksPage'),
  '/action-center': () => void import('@/pages/ActionCenterPage'),
  '/integrations': () => void import('@/pages/IntegrationsManager'),
  '/artifacts': () => void import('@/pages/ArtifactLibrary'),
  '/secrets': () => void import('@/pages/SecretsManager'),
  '/api-keys': () => void import('@/pages/ApiKeysManager'),
  '/mcp-library': () => void import('@/pages/McpLibraryPage'),
  '/analytics-settings': () => void import('@/pages/AnalyticsSettingsPage'),
};

/** Prefetch all sidebar route chunks during browser idle time. */
export function prefetchIdleRoutes(): void {
  const prefetch = () => {
    Object.values(routePrefetchMap).forEach((fn) => fn());
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(prefetch, { timeout: 10_000 });
  } else {
    setTimeout(prefetch, 3_000);
  }
}

/** Prefetch a single route chunk on sidebar hover. */
export function prefetchRoute(href: string): void {
  const clean = href.split('?')[0];
  const fn = routePrefetchMap[clean];
  if (fn) fn();
}
