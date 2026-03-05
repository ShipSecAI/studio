import { type ElementType, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Container, FileCode2, KeyRound, Package, Workflow } from 'lucide-react';
import { formatRelativeTime } from '@/components/scans/scan-utils';
import type { GitHubScanResult, GitHubRepo } from '@/store/githubStore';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { IntegrationConnection } from '@/services/api';

interface RecentActivityFeedProps {
  scanResults: GitHubScanResult[];
  repositories: GitHubRepo[];
  recentRuns?: ExecutionRun[];
  connections?: IntegrationConnection[];
}

const FEED_RENDER_LIMIT = 120;

type ScanType = 'sast' | 'dependency' | 'secret' | 'generic';

function detectScanType(name: string): ScanType {
  const lower = name.toLowerCase();
  if (lower.includes('sast') || lower.includes('code scan')) return 'sast';
  if (lower.includes('dependency') || lower.includes('sca') || lower.includes('supply chain'))
    return 'dependency';
  if (lower.includes('secret')) return 'secret';
  return 'generic';
}

const SCAN_TYPE_ICON: Record<ScanType, { icon: ElementType; bg: string; color: string }> = {
  sast: {
    icon: FileCode2,
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    color: 'text-blue-600 dark:text-blue-400',
  },
  dependency: {
    icon: Package,
    bg: 'bg-purple-100 dark:bg-purple-900/40',
    color: 'text-purple-600 dark:text-purple-400',
  },
  secret: {
    icon: KeyRound,
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    color: 'text-amber-600 dark:text-amber-400',
  },
  generic: { icon: Workflow, bg: 'bg-muted', color: 'text-muted-foreground' },
};

/** Unified item rendered in the feed */
interface FeedItem {
  id: string;
  label: string;
  subtitle?: string;
  status: string;
  timestamp: string;
  href: string;
  provider: 'github' | 'aws' | 'workflow';
  containerRegistry?: ContainerRegistry;
  scanType?: ScanType;
}

const STATUS_DOT_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  completed: 'bg-green-500',
  failure: 'bg-red-500',
  failed: 'bg-red-500',
  error: 'bg-red-500',
  running: 'bg-blue-500 animate-pulse',
  pending: 'bg-yellow-500',
  cancelled: 'bg-gray-400',
  terminated: 'bg-gray-400',
  timed_out: 'bg-orange-500',
};

/** Provider logo paths keyed by scan source type */
const PROVIDER_LOGO: Record<string, { src: string; alt: string }> = {
  github: { src: '/icons/github.svg', alt: 'GitHub' },
  aws: { src: '/icons/aws.svg', alt: 'AWS' },
};

/** Container registry types detected from imageRef */
type ContainerRegistry = 'dockerhub' | 'ghcr' | 'ecr';

const REGISTRY_LOGO: Record<ContainerRegistry, { src: string; alt: string }> = {
  dockerhub: { src: '/icons/docker.svg', alt: 'Docker Hub' },
  ghcr: { src: '/icons/github.svg', alt: 'GHCR' },
  ecr: { src: '/icons/aws.svg', alt: 'AWS ECR' },
};

function detectContainerRegistry(imageRef: string): ContainerRegistry {
  const ref = imageRef.toLowerCase();
  if (ref.startsWith('ghcr.io/')) return 'ghcr';
  if (/\.dkr\.ecr\.[^.]+\.amazonaws\.com\//.test(ref)) return 'ecr';
  return 'dockerhub';
}

function isCloudWorkflow(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('prowler') || lower.includes('cloud') || lower.includes('cspm');
}

function formatFullTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ProviderIcon({
  provider,
  containerRegistry,
  scanType = 'generic',
}: {
  provider: FeedItem['provider'];
  containerRegistry?: ContainerRegistry;
  scanType?: ScanType;
}) {
  if (containerRegistry) {
    const logo = REGISTRY_LOGO[containerRegistry];
    return (
      <div className="relative w-6 h-6">
        <img src={logo.src} alt={logo.alt} className="w-6 h-6 rounded object-contain" />
        <div className="absolute -bottom-1 -left-1 w-3.5 h-3.5 rounded-full bg-background border border-border flex items-center justify-center">
          <Container className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      </div>
    );
  }
  if (provider === 'workflow') {
    const { icon: Icon, bg, color } = SCAN_TYPE_ICON[scanType];
    return (
      <div className={`w-6 h-6 rounded ${bg} flex items-center justify-center`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
    );
  }
  const logo = PROVIDER_LOGO[provider] ?? PROVIDER_LOGO.github;
  return <img src={logo.src} alt={logo.alt} className="w-6 h-6 rounded object-contain" />;
}

export function RecentActivityFeed({
  scanResults,
  repositories,
  recentRuns = [],
  connections = [],
}: RecentActivityFeedProps) {
  const feedItems = useMemo(() => {
    const repoNameById = new Map(repositories.map((repo) => [repo.id, repo.fullName]));

    // Build connection lookup map for resolving connectionId → display name
    const connectionMap = new Map(connections.map((c) => [c.id, c.displayName ?? c.providerName]));

    // Build set of workflow run IDs that already appear as GitHub scans (for dedup)
    const githubRunIds = new Set(scanResults.map((s) => s.workflowRunId));

    // Normalize GitHub scan results
    const fromScans: FeedItem[] = scanResults.map((scan) => {
      const repoFullName = repoNameById.get(scan.repositoryId);
      const label = repoFullName?.split('/').pop() ?? 'Unknown';
      const isCloud =
        scan.workflowName?.toLowerCase().includes('prowler') ||
        scan.workflowName?.toLowerCase().includes('cloud');

      // Build subtitle based on scan type
      let subtitle: string | undefined;
      if (scan.summary) {
        const parts: string[] = [];
        if (scan.prNumber) parts.push(`PR #${scan.prNumber}`);
        if (scan.branch) parts.push(scan.branch);
        const sevParts: string[] = [];
        if (scan.summary.critical > 0) sevParts.push(`${scan.summary.critical}c`);
        if (scan.summary.high > 0) sevParts.push(`${scan.summary.high}h`);
        if (sevParts.length > 0) parts.push(sevParts.join(' '));
        if (parts.length > 0) subtitle = parts.join(' \u00B7 ');
      }

      return {
        id: `scan-${scan.id}`,
        label,
        subtitle,
        status: scan.status,
        timestamp: scan.completedAt ?? scan.createdAt,
        href: `/github/scans/${scan.id}`,
        provider: isCloud ? 'aws' : ('github' as const),
      };
    });

    // Normalize workflow runs (exclude those already shown as GitHub scans)
    const fromRuns: FeedItem[] = recentRuns
      .filter((run) => !githubRunIds.has(run.id))
      .map((run) => {
        const isCloud = isCloudWorkflow(run.workflowName);

        // Build subtitle based on workflow type
        let subtitle: string | undefined;
        const runtimeInputs = run.inputPreview?.runtimeInputs ?? {};
        if (isCloud) {
          const connId = runtimeInputs.connectionId as string | undefined;
          const connName = connId ? connectionMap.get(connId) : undefined;
          const parts: string[] = [];
          if (connName) parts.push(connName);
          if (run.triggerLabel) parts.push(run.triggerLabel);
          if (parts.length > 0) subtitle = parts.join(' \u00B7 ');
        } else if (runtimeInputs.imageRef) {
          const parts = [String(runtimeInputs.imageRef)];
          if (run.triggerLabel) parts.push(run.triggerLabel);
          subtitle = parts.join(' \u00B7 ');
        } else if (run.triggerLabel) {
          subtitle = run.triggerLabel;
        }

        return {
          id: `run-${run.id}`,
          label: run.workflowName,
          subtitle,
          status: run.status.toLowerCase(),
          timestamp: run.endTime ?? run.startTime,
          href: `/workflows/${run.workflowId}/runs/${run.id}`,
          provider: isCloud ? 'aws' : ('workflow' as const),
          containerRegistry: runtimeInputs.imageRef
            ? detectContainerRegistry(String(runtimeInputs.imageRef))
            : undefined,
          scanType: isCloud ? undefined : detectScanType(run.workflowName),
        };
      });

    // Merge and sort by timestamp (newest first) — no hard cap
    return [...fromScans, ...fromRuns].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [scanResults, repositories, recentRuns, connections]);

  const visibleFeedItems = useMemo(
    () =>
      feedItems.length > FEED_RENDER_LIMIT ? feedItems.slice(0, FEED_RENDER_LIMIT) : feedItems,
    [feedItems],
  );

  const hiddenCount = Math.max(0, feedItems.length - visibleFeedItems.length);

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Recent Scans</CardTitle>
          {feedItems.length > 5 && (
            <span className="text-xs text-muted-foreground font-normal">({feedItems.length})</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {feedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scans yet.</p>
        ) : (
          <div
            className={
              feedItems.length > 5
                ? 'max-h-[320px] overflow-y-auto overflow-x-hidden space-y-1 pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [scrollbar-width:thin]'
                : 'space-y-1'
            }
          >
            {visibleFeedItems.map((item) => {
              const dotColor = STATUS_DOT_COLOR[item.status] ?? STATUS_DOT_COLOR.pending;
              const time = formatRelativeTime(item.timestamp);

              return (
                <Link
                  key={item.id}
                  to={item.href}
                  className="flex items-start gap-2 text-xs hover:bg-muted/50 rounded p-1.5 -mx-1 transition-colors"
                >
                  <div className="relative w-6 h-6 flex-shrink-0 mt-0.5">
                    <ProviderIcon
                      provider={item.provider}
                      containerRegistry={item.containerRegistry}
                      scanType={item.scanType}
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${dotColor}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{item.label}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 cursor-default">
                            {time}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{formatFullTimestamp(item.timestamp)}</TooltipContent>
                      </Tooltip>
                    </div>
                    {item.subtitle && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5 max-w-[calc(100%-4rem)]">
                            {item.subtitle}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs break-words">
                          {item.subtitle}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </Link>
              );
            })}
            {hiddenCount > 0 && (
              <div className="px-1.5 py-1 text-[11px] text-muted-foreground">
                Showing latest {visibleFeedItems.length} items. {hiddenCount} older items hidden.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
