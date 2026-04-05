import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  id: string;
  name: string;
  description: string;
  logo: string;
  darkLogo?: string;
  darkBg?: boolean;
  gradient: string;
  borderAccent: string;
  hoverGradient: string;
  category: string;
  route: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'aws',
    name: 'AWS',
    description: 'Connect your AWS accounts for cloud security scanning and compliance checks.',
    logo: '/icons/aws.svg',
    darkLogo: '/icons/aws-dark.svg',
    darkBg: true,
    gradient: '',
    borderAccent: 'hover:border-orange-300 dark:hover:border-orange-700',
    hoverGradient: 'linear-gradient(to right, #f97316, #f59e0b)',
    category: 'Cloud Security',
    route: '/integrations/aws',
  },
  {
    id: 'slack',
    name: 'Slack',
    description:
      'Send workflow notifications, security alerts, and scan results to Slack channels.',
    logo: '/icons/slack.svg',
    gradient: 'from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20',
    borderAccent: 'hover:border-purple-300 dark:hover:border-purple-700',
    hoverGradient: 'linear-gradient(to right, #a855f7, #ec4899)',
    category: 'Notifications',
    route: '/integrations/slack',
  },
];

const COMING_SOON: { name: string; icon?: string }[] = [
  { name: 'Jira', icon: '/icons/jira.svg' },
  { name: 'Linear' },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function IntegrationsPage() {
  const navigate = useNavigate();

  const { data: orgConnections = [], isLoading: loadingOrgConnections } =
    useIntegrationConnections();

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const conn of orgConnections) {
      counts.set(conn.provider, (counts.get(conn.provider) ?? 0) + 1);
    }
    return counts;
  }, [orgConnections]);

  const isLoading = loadingOrgConnections;

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
            {PROVIDERS.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-6 space-y-4">
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
            {PROVIDERS.map((provider) => {
              const count = connectionCounts.get(provider.id) ?? 0;
              const isConnected = count > 0;

              return (
                <div
                  key={provider.id}
                  className={cn(
                    'group relative rounded-xl border bg-card transition-all duration-200 cursor-pointer overflow-hidden',
                    'hover:shadow-lg hover:-translate-y-0.5',
                    provider.borderAccent,
                  )}
                  onClick={() => navigate(provider.route)}
                >
                  {/* Gradient accent top bar */}
                  <div
                    className="absolute inset-x-0 top-0 h-1 rounded-t-xl opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: provider.hoverGradient }}
                  />

                  <div className="p-6 flex flex-col h-full">
                    {/* Logo + Info */}
                    <div className="flex items-start gap-4 flex-1">
                      {provider.darkBg ? (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#232F3E] flex-shrink-0 p-2.5">
                          <img
                            src={provider.darkLogo ?? provider.logo}
                            alt={provider.name}
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : provider.gradient ? (
                        <div
                          className={cn(
                            'flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br flex-shrink-0 p-2.5',
                            provider.gradient,
                          )}
                        >
                          <img
                            src={provider.logo}
                            alt={provider.name}
                            className="h-full w-full object-contain"
                          />
                        </div>
                      ) : (
                        <img
                          src={provider.logo}
                          alt={provider.name}
                          className="h-14 w-14 rounded-xl object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold tracking-tight">{provider.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {provider.description}
                        </p>
                      </div>
                    </div>

                    {/* Status + Action */}
                    <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
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
              {COMING_SOON.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/30 p-3 opacity-50 grayscale"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 flex-shrink-0 p-1.5">
                    {item.icon ? (
                      <img
                        src={item.icon}
                        alt={item.name}
                        className="h-full w-full object-contain dark:invert-[0.5]"
                      />
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">
                        {item.name.slice(0, 2)}
                      </span>
                    )}
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
