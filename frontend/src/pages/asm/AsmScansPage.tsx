import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAsmScans } from '@/hooks/queries/useAsmQueries';

const PAGE_SIZE = 25;

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  COMPLETED: CheckCircle2,
  RUNNING: Loader2,
  FAILED: XCircle,
  TIMED_OUT: AlertTriangle,
  QUEUED: Clock,
  AWAITING_INPUT: Clock,
};

const BASE_STATUS_BADGE = 'border-border/80 bg-background text-muted-foreground';
const STATUS_COLORS: Record<string, string> = {
  COMPLETED: `${BASE_STATUS_BADGE} text-success`,
  RUNNING: `${BASE_STATUS_BADGE} text-primary`,
  FAILED: `${BASE_STATUS_BADGE} text-destructive`,
  TIMED_OUT: `${BASE_STATUS_BADGE} text-warning`,
  QUEUED: BASE_STATUS_BADGE,
  AWAITING_INPUT: BASE_STATUS_BADGE,
};

function formatDuration(ms: number | undefined): string {
  if (!ms) return '-';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function extractDomain(triggerSource?: string | null): string | null {
  if (!triggerSource) return null;
  return triggerSource.startsWith('asm:') ? triggerSource.slice(4) : null;
}

function StatusBadge({ status }: { status: string }) {
  const Icon = STATUS_ICONS[status] ?? Clock;
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.QUEUED;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${colors}`}>
      <Icon className={`h-3 w-3 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {status.replace('_', ' ')}
    </Badge>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded" />
      ))}
    </div>
  );
}

export function AsmScansPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const navigate = useNavigate();

  const { data, isLoading } = useAsmScans({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: statusFilter || undefined,
  });

  const runs = data?.runs ?? [];
  const liveRuns = runs.filter((r) => r.status === 'RUNNING');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ASM Scans</h1>
          <p className="text-muted-foreground text-sm mt-1">
            History of attack surface discovery scans
          </p>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-3 mb-4">
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(v) => {
            setStatusFilter(v === '__all__' ? '' : v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="timed_out">Timed Out</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Live scans section */}
      {liveRuns.length > 0 && (
        <div className="mb-6 rounded-lg border bg-muted/25 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-sm font-medium">
              {liveRuns.length} scan{liveRuns.length !== 1 ? 's' : ''} in progress
            </span>
          </div>
          <div className="space-y-2">
            {liveRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between bg-background rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/runs/${run.id}`)}
              >
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {run.workflowName || run.triggerLabel || 'ASM Scan'}
                  </span>
                  {extractDomain(run.triggerSource) && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${extractDomain(run.triggerSource)}&sz=16`}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                      />
                      {extractDomain(run.triggerSource)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {run.startTime ? formatTime(run.startTime) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scan history table */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : runs.length === 0 ? (
        <section className="rounded-xl border bg-card/80 p-6 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex max-w-2xl gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted/70">
                <Radar className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold tracking-tight">No scans yet</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Scan history appears here after a domain discovery run starts from the Domains
                  page.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/asm/domains')}>
              Go to domains
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Scan</th>
                  <th className="text-left px-4 py-3 font-medium">Domain</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/runs/${run.id}`)}
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.startTime ? formatTime(run.startTime) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {run.workflowName || run.triggerLabel || 'ASM Scan'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {extractDomain(run.triggerSource) ? (
                        <span className="flex items-center gap-1.5">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${extractDomain(run.triggerSource)}&sz=16`}
                            alt=""
                            className="h-4 w-4 rounded-sm"
                          />
                          {extractDomain(run.triggerSource)}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                      {formatDuration(run.duration)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={runs.length < PAGE_SIZE}
                onClick={() => setPage(page + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
