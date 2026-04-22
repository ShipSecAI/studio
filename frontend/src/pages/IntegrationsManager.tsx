import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useIntegrationCatalog,
  useIntegrationConnections,
} from '@/hooks/queries/useIntegrationQueries';
import { cn } from '@/lib/utils';

/** Static metadata for the active providers. */
const PROVIDER_META: Record<
  string,
  {
    name: string;
    description: string;
    logo?: string;
    route: string;
    gradient: string;
    borderAccent: string;
    badgeClass: string;
    category: string;
    hoverGradient: string;
    darkBg?: boolean;
    darkLogo?: string;
    monogram?: string;
    monogramClassName?: string;
  }
> = {
  aws: {
    name: 'AWS',
    description: 'Connect your AWS accounts for cloud security scanning and compliance checks.',
    logo: '/icons/aws.svg',
    darkLogo: '/icons/aws-dark.svg',
    route: '/integrations/aws',
    gradient: '',
    darkBg: true,
    borderAccent: 'hover:border-orange-300 dark:hover:border-orange-700',
    badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    category: 'Cloud Security',
    hoverGradient: 'linear-gradient(to right, #f97316, #f59e0b)',
  },
  gcp: {
    name: 'Google Cloud',
    description:
      'Connect GCP projects and organizations for cloud inventory indexing, graph mapping, and posture visibility.',
    logo: '/icons/gcp.svg',
    route: '/integrations/gcp',
    gradient: 'from-sky-50 to-blue-50 dark:from-sky-950/20 dark:to-blue-950/20',
    borderAccent: 'hover:border-sky-300 dark:hover:border-sky-700',
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    category: 'Cloud Security',
    hoverGradient: 'linear-gradient(to right, #4285F4, #34A853)',
  },
  slack: {
    name: 'Slack',
    description:
      'Send workflow notifications, security alerts, and scan results to Slack channels.',
    logo: '/icons/slack.svg',
    route: '/integrations/slack',
    gradient: 'from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20',
    borderAccent: 'hover:border-purple-300 dark:hover:border-purple-700',
    badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    category: 'Notifications',
    hoverGradient: 'linear-gradient(to right, #a855f7, #ec4899)',
  },
  jira: {
    name: 'Jira',
    description: 'Create and manage Jira issue workflows from Studio.',
    logo: '/icons/jira.svg',
    route: '/integrations/jira',
    gradient: 'from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20',
    borderAccent: 'hover:border-blue-300 dark:hover:border-blue-700',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    category: 'Ticketing',
    hoverGradient: 'linear-gradient(to right, #3b82f6, #6366f1)',
  },
};

/** IDs of the providers shown on this page, in display order. */
const VISIBLE_PROVIDERS = ['aws', 'gcp', 'slack', 'jira'] as const;

export function IntegrationsManager() {
  const navigate = useNavigate();

  const { data: catalog = [], isLoading: loadingCatalog } = useIntegrationCatalog();
  const { data: orgConnections = [], isLoading: loadingOrgConnections } =
    useIntegrationConnections();

  /** Map provider id -> number of org-scoped connections. */
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conn of orgConnections) {
      counts.set(conn.provider, (counts.get(conn.provider) ?? 0) + 1);
    }
    return counts;
  }, [orgConnections]);

  /** Catalog entries keyed by id for quick lookup. */
  const catalogById = useMemo(() => {
    return new Map(catalog.map((entry) => [entry.id, entry]));
  }, [catalog]);

  const isLoading = loadingCatalog || loadingOrgConnections;

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-6 max-w-6xl">
        <div className="mb-8">
          <p className="text-muted-foreground">
            Connect external services to enable cloud security scanning, notifications, and more.
          </p>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {VISIBLE_PROVIDERS.map((id) => (
              <div key={id} className="rounded-xl border bg-card p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-14 w-14 rounded-xl flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <Skeleton className="h-6 w-28" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Provider cards */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {VISIBLE_PROVIDERS.map((providerId) => {
              const meta = PROVIDER_META[providerId];
              const entry = catalogById.get(providerId);
              const count = connectionCounts.get(providerId) ?? 0;
              const isConnected = count > 0;

              return (
                <div
                  key={providerId}
                  className={cn(
                    'group relative rounded-xl border bg-card transition-all duration-200 cursor-pointer overflow-hidden',
                    'hover:shadow-lg hover:-translate-y-0.5',
                    meta.borderAccent,
                  )}
                  onClick={() => navigate(meta.route)}
                >
                  {/* Gradient accent top bar */}
                  <div
                    className={cn(
                      'absolute inset-x-0 top-0 h-1 rounded-t-xl bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity',
                      meta.gradient.replace('from-', 'from-').replace('dark:', ''),
                    )}
                    style={{
                      background: meta.hoverGradient,
                    }}
                  />

                  <div className="p-6 flex flex-col h-full">
                    {/* Logo + Info */}
                    <div className="flex items-start gap-4 flex-1">
                      {meta.logo && meta.gradient ? (
                        <div
                          className={cn(
                            'flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br flex-shrink-0 p-2.5',
                            meta.gradient,
                          )}
                        >
                          <img
                            src={meta.logo}
                            alt={entry?.name ?? providerId}
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : meta.logo && meta.darkBg ? (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#232F3E] flex-shrink-0 p-2.5">
                          <img
                            src={meta.darkLogo ?? meta.logo}
                            alt={entry?.name ?? providerId}
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : meta.logo ? (
                        <img
                          src={meta.logo}
                          alt={entry?.name ?? providerId}
                          className="h-14 w-14 rounded-xl object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className={cn(
                            'flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br flex-shrink-0 text-sm font-semibold tracking-wide',
                            meta.gradient,
                            meta.monogramClassName,
                          )}
                        >
                          {meta.monogram ?? (entry?.name ?? providerId).slice(0, 3).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold tracking-tight">
                            {entry?.name ?? meta.name}
                          </h3>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {entry?.description ?? meta.description}
                        </p>
                      </div>
                    </div>

                    {/* Status + Action */}
                    <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50 mt-auto">
                      <div className="flex items-center gap-2">
                        {isConnected ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            <Badge
                              variant="secondary"
                              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 font-medium"
                            >
                              {count} {count === 1 ? 'connection' : 'connections'}
                            </Badge>
                          </>
                        ) : (
                          <>
                            <Circle className="h-4 w-4 text-muted-foreground/40" />
                            <span className="text-sm text-muted-foreground">Not configured</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        Configure
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
