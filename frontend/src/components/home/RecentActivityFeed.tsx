import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/components/scans/scan-utils';
import type { GitHubScanResult, GitHubRepo } from '@/store/githubStore';

interface RecentActivityFeedProps {
  scanResults: GitHubScanResult[];
  repositories: GitHubRepo[];
}

const STATUS_DOT_COLOR: Record<string, string> = {
  success: 'bg-green-500',
  failure: 'bg-red-500',
  error: 'bg-red-500',
  running: 'bg-blue-500 animate-pulse',
  pending: 'bg-yellow-500',
};

/** Provider logo paths keyed by scan source type */
const PROVIDER_LOGO: Record<string, { src: string; alt: string }> = {
  github: { src: '/icons/github.svg', alt: 'GitHub' },
  aws: { src: '/icons/aws.png', alt: 'AWS' },
};

function getProviderLogo(scan: GitHubScanResult) {
  // Cloud security scans (Prowler) target AWS
  if (
    scan.workflowName?.toLowerCase().includes('prowler') ||
    scan.workflowName?.toLowerCase().includes('cloud')
  ) {
    return PROVIDER_LOGO.aws;
  }
  // Default: GitHub repo scan
  return PROVIDER_LOGO.github;
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

export function RecentActivityFeed({ scanResults, repositories }: RecentActivityFeedProps) {
  const recentScans = scanResults
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    )
    .slice(0, 5);

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Scans</CardTitle>
        </CardHeader>
        <CardContent>
          {recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scans yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentScans.map((scan) => {
                const repo = repositories.find((r) => r.id === scan.repositoryId);
                const repoName = repo?.fullName?.split('/').pop() ?? 'Unknown';
                const dotColor = STATUS_DOT_COLOR[scan.status] ?? STATUS_DOT_COLOR.pending;
                const rawTimestamp = scan.completedAt ?? scan.createdAt;
                const time = formatRelativeTime(rawTimestamp);
                const logo = getProviderLogo(scan);

                return (
                  <Link
                    key={scan.id}
                    to={`/github/scans/${scan.id}`}
                    className="flex items-center gap-2 text-xs hover:bg-muted/50 rounded p-1.5 -mx-1 transition-colors"
                  >
                    <div className="relative w-6 h-6 flex-shrink-0">
                      <img
                        src={logo.src}
                        alt={logo.alt}
                        className="w-6 h-6 rounded object-contain"
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${dotColor}`}
                      />
                    </div>
                    <span className="truncate flex-1 min-w-0">{repoName}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 cursor-default">
                          {time}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{formatFullTimestamp(rawTimestamp)}</TooltipContent>
                    </Tooltip>
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
