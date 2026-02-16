import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, Clock, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '@/components/scans/scan-utils';
import type { GitHubScanResult, GitHubRepo } from '@/store/githubStore';

interface RecentActivityFeedProps {
  scanResults: GitHubScanResult[];
  repositories: GitHubRepo[];
}

const STATUS_CONFIG: Record<string, { icon: typeof Check; color: string; bg: string }> = {
  success: { icon: Check, color: 'text-green-500', bg: 'bg-green-500/10' },
  failure: { icon: X, color: 'text-red-500', bg: 'bg-red-500/10' },
  error: { icon: X, color: 'text-red-500', bg: 'bg-red-500/10' },
  running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
};

export function RecentActivityFeed({ scanResults, repositories }: RecentActivityFeedProps) {
  const recentScans = scanResults
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.createdAt).getTime() -
        new Date(a.completedAt ?? a.createdAt).getTime(),
    )
    .slice(0, 5);

  return (
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
              const config = STATUS_CONFIG[scan.status] ?? STATUS_CONFIG.pending;
              const Icon = config.icon;
              const time = formatRelativeTime(scan.completedAt ?? scan.createdAt);

              return (
                <Link
                  key={scan.id}
                  to={`/integrations/github/scans/${scan.id}`}
                  className="flex items-center gap-2 text-xs hover:bg-muted/50 rounded p-1.5 -mx-1 transition-colors"
                >
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${config.bg}`}
                  >
                    <Icon
                      className={`h-3 w-3 ${config.color} ${scan.status === 'running' ? 'animate-spin' : ''}`}
                    />
                  </div>
                  <span className="truncate flex-1 min-w-0">{repoName}</span>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{time}</span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
