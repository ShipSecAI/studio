import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plug, CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useIntegrationStore } from '@/store/integrationStore';
import { cn } from '@/lib/utils';

/** Static metadata for the two D5 providers (AWS + Slack). */
const PROVIDER_META: Record<
  string,
  {
    logo: string;
    route: string;
    gradient: string;
    borderAccent: string;
    badgeClass: string;
    category: string;
  }
> = {
  aws: {
    logo: '/icons/aws.png',
    route: '/integrations/aws',
    gradient: '',
    borderAccent: 'hover:border-orange-300 dark:hover:border-orange-700',
    badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    category: 'Cloud Security',
  },
  slack: {
    logo: '/icons/slack.svg',
    route: '/integrations/slack',
    gradient: 'from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20',
    borderAccent: 'hover:border-purple-300 dark:hover:border-purple-700',
    badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    category: 'Notifications',
  },
};

/** IDs of the providers shown on this page, in display order. */
const VISIBLE_PROVIDERS = ['aws', 'slack'] as const;

export function IntegrationsManager() {
  const navigate = useNavigate();

  const {
    catalog,
    orgConnections,
    fetchCatalog,
    fetchOrgConnections,
    loadingCatalog,
    loadingOrgConnections,
  } = useIntegrationStore();

  useEffect(() => {
    fetchCatalog();
    fetchOrgConnections();
  }, [fetchCatalog, fetchOrgConnections]);

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
      <div className="container mx-auto py-10 px-6 max-w-5xl">
        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Plug className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect external services to enable cloud security scanning, notifications, and
                more.
              </p>
            </div>
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {VISIBLE_PROVIDERS.map((providerId) => {
              const meta = PROVIDER_META[providerId];
              const entry = catalogById.get(providerId);
              const count = connectionCounts.get(providerId) ?? 0;
              const isConnected = count > 0;

              return (
                <div
                  key={providerId}
                  className={cn(
                    'group relative rounded-xl border bg-card transition-all duration-200 cursor-pointer',
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
                      background:
                        providerId === 'aws'
                          ? 'linear-gradient(to right, #f97316, #f59e0b)'
                          : 'linear-gradient(to right, #a855f7, #ec4899)',
                    }}
                  />

                  <div className="p-6 flex flex-col h-full">
                    {/* Logo + Info */}
                    <div className="flex items-start gap-4 flex-1">
                      {meta.gradient ? (
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
                      ) : (
                        <img
                          src={meta.logo}
                          alt={entry?.name ?? providerId}
                          className="h-14 w-14 rounded-xl object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold tracking-tight">
                            {entry?.name ?? providerId.toUpperCase()}
                          </h3>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {entry?.description ?? 'Integration provider'}
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

        {/* Coming soon section */}
        {!isLoading && (
          <div className="mt-12">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Coming Soon
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[
                { name: 'GitHub', icon: '/icons/github.svg' },
                { name: 'Jira', icon: '/icons/jira.svg' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/30 p-3 opacity-50 grayscale"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 flex-shrink-0 p-1.5">
                    <img
                      src={item.icon}
                      alt={item.name}
                      className="h-full w-full object-contain dark:invert-[0.5]"
                    />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
