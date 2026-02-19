import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Workflow } from 'lucide-react';
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

/** Unified item rendered in the feed */
interface FeedItem {
  id: string;
  label: string;
  subtitle?: string;
  status: string;
  timestamp: string;
  href: string;
  provider: 'github' | 'aws' | 'workflow';
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

function ProviderIcon({ provider }: { provider: FeedItem['provider'] }) {
  if (provider === 'workflow') {
    return (
      <div className="w-6 h-6 rounded bg-muted flex items-center justify-center">
        <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
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
    // Build connection lookup map for resolving connectionId → display name
    const connectionMap = new Map(connections.map((c) => [c.id, c.displayName ?? c.providerName]));

    // Build set of workflow run IDs that already appear as GitHub scans (for dedup)
    const githubRunIds = new Set(scanResults.map((s) => s.workflowRunId));

    // Normalize GitHub scan results
    const fromScans: FeedItem[] = scanResults.map((scan) => {
      const repo = repositories.find((r) => r.id === scan.repositoryId);
      const label = repo?.fullName?.split('/').pop() ?? 'Unknown';
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
        };
      });

    // Merge and sort by timestamp (newest first) — no hard cap
    return [...fromScans, ...fromRuns].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [scanResults, repositories, recentRuns, connections]);

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Recent Scans</CardTitle>
            {feedItems.length > 5 && (
              <span className="text-xs text-muted-foreground font-normal">
                ({feedItems.length})
              </span>
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
                  ? 'max-h-[320px] overflow-y-auto space-y-1 pr-1 scrollbar-thin'
                  : 'space-y-1'
              }
            >
              {feedItems.map((item) => {
                const dotColor = STATUS_DOT_COLOR[item.status] ?? STATUS_DOT_COLOR.pending;
                const time = formatRelativeTime(item.timestamp);

                return (
                  <Link
                    key={item.id}
                    to={item.href}
                    className="flex items-start gap-2 text-xs hover:bg-muted/50 rounded p-1.5 -mx-1 transition-colors"
                  >
                    <div className="relative w-6 h-6 flex-shrink-0 mt-0.5">
                      <ProviderIcon provider={item.provider} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${dotColor}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
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
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
