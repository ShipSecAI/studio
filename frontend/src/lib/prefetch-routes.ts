/**
 * Route chunk prefetching utility.
 *
 * Maps sidebar navigation paths to their dynamic import() calls (mirroring
 * the React.lazy definitions in App.tsx). This pre-downloads the JS chunks
 * so navigation feels instant.
 */

type PrefetchFn = () => void;

const routePrefetchMap: Record<string, PrefetchFn> = {
  '/': () => void import('@/pages/HomePage'),
  '/activity': () => void import('@/pages/ActivityPage'),
  '/builder': () => void import('@/pages/WorkflowList'),
  '/templates': () => void import('@/pages/WorkflowTemplatesPage'),
  '/report-templates': () => void import('@/pages/ReportTemplatesPage'),
  '/github/repositories': () => void import('@/pages/GitHubPage'),
  '/github/scans': () => void import('@/pages/GitHubPage'),
  '/github/triggers': () => void import('@/pages/GitHubPage'),
  '/dashboards/security': () => void import('@/pages/SecurityDashboard'),
  '/findings': () => void import('@/pages/FindingsPage'),
  '/cloud/accounts': () => void import('@/pages/CloudAccountsPage'),
  '/cloud/inventory': () => void import('@/pages/CloudInventoryPage'),
  '/cloud/scans': () => void import('@/pages/CloudAccountsPage'),
  '/asm/domains': () => void import('@/pages/asm/DomainsPage'),
  '/asm/assets': () => void import('@/pages/asm/AssetsPage'),
  '/asm/scans': () => void import('@/pages/asm/AsmScansPage'),
  '/recon': () => void import('@/pages/asm/DomainsPage'),
  '/schedules': () => void import('@/pages/SchedulesPage'),
  '/webhooks': () => void import('@/pages/WebhooksPage'),
  '/action-center': () => void import('@/pages/ActionCenterPage'),
  '/integrations': () => void import('@/pages/IntegrationsPage'),
  '/artifacts': () => void import('@/pages/ArtifactLibrary'),
  '/secrets': () => void import('@/pages/SecretsManager'),
  '/api-keys': () => void import('@/pages/ApiKeysManager'),
  '/mcp-library': () => void import('@/pages/McpLibraryPage'),
  '/analytics-settings': () => void import('@/pages/AnalyticsSettingsPage'),
  '/settings': () => void import('@/pages/SettingsPage'),
  '/settings/audit': () => void import('@/pages/SettingsPage'),
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
