import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { StopCircle, Search, CalendarClock, ArrowRight, Loader2 } from 'lucide-react';
import { useActivityRuns, useCancelRun } from '@/hooks/queries/useActivityQueries';
import { useSchedules } from '@/hooks/queries/useScheduleQueries';
import { getTriggerDisplay } from '@/utils/triggerDisplay';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { formatRelativeTime, formatExactTime } from '@/components/scans/scan-utils';
import type { ExecutionTriggerType } from '@shipsec/shared';

type StatusTab = 'all' | 'running' | 'completed' | 'failed';

const STATUS_TAB_MAP: Record<StatusTab, string | undefined> = {
  all: undefined,
  running: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

function formatDuration(ms?: number): string {
  if (ms == null || ms <= 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatFutureRelative(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'now';
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `in ${diffHours}h`;
  const diffDays = Math.floor(diffMs / 86400000);
  return `in ${diffDays}d`;
}

// --- Upcoming Schedules ---

function UpcomingSchedules() {
  const { data: schedules, isLoading } = useSchedules({ status: 'active' });

  const upcoming = useMemo(() => {
    if (!schedules) return [];
    return [...schedules]
      .filter((s) => s.nextRunAt)
      .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
      .slice(0, 3);
  }, [schedules]);

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 flex-1" />
          ))}
        </div>
      </div>
    );
  }

  if (upcoming.length === 0) return null;

  const totalActive = schedules?.filter((s) => s.nextRunAt).length ?? 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Upcoming Schedules
          {totalActive > 3 && (
            <Badge variant="secondary" className="text-[10px]">
              {totalActive} total
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
          <Link to="/schedules">
            View all schedules
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </div>
      <div className="flex gap-3 flex-wrap">
        {upcoming.map((schedule) => (
          <div
            key={schedule.id}
            className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">
              {formatFutureRelative(schedule.nextRunAt)}
            </span>
            <span className="font-medium truncate max-w-[200px]">{schedule.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main Page ---

export default function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read filters from URL
  const statusTab = (searchParams.get('status') as StatusTab) || 'all';
  const triggerFilter = (searchParams.get('trigger') as ExecutionTriggerType) || '';
  const searchQuery = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '0', 10);

  const LIMIT = 25;

  const [searchInput, setSearchInput] = useState(searchQuery);

  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        // Reset page on filter change
        if (key !== 'page') next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const { data, isLoading } = useActivityRuns({
    status: STATUS_TAB_MAP[statusTab],
    triggerType: triggerFilter ? (triggerFilter as ExecutionTriggerType) : undefined,
    search: searchQuery || undefined,
    limit: LIMIT,
    offset: page * LIMIT,
  });

  const cancelRun = useCancelRun();

  const items = data?.items ?? [];
  const hasMore = data?.hasMore ?? false;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter('search', searchInput.trim());
  };

  const statusTabs: { key: StatusTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' },
  ];

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>

        {/* Upcoming Schedules */}
        <UpcomingSchedules />

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status tabs */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter('status', tab.key === 'all' ? '' : tab.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  statusTab === tab.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Trigger type filter */}
          <Select
            value={triggerFilter || '__all__'}
            onValueChange={(v) => setFilter('trigger', v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue placeholder="All triggers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All triggers</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="schedule">Schedule</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search workflows..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-9 w-[200px]"
              />
            </div>
            {searchInput !== searchQuery && (
              <Button type="submit" size="sm" variant="outline" className="h-9">
                Search
              </Button>
            )}
          </form>
        </div>

        {/* Activity Table */}
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="hidden md:table-cell w-[120px]">Trigger</TableHead>
                  <TableHead className="hidden lg:table-cell w-[140px]">Started</TableHead>
                  <TableHead className="hidden lg:table-cell w-[100px]">Duration</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-5 w-48" />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-5 w-20" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Skeleton className="h-5 w-16" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Skeleton className="h-5 w-12" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-7 w-14" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      {searchQuery || triggerFilter || statusTab !== 'all'
                        ? 'No runs match filters'
                        : 'No activity yet'}
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const triggerDisplay = getTriggerDisplay(item.triggerType, item.triggerLabel);
                    const isLive = item.isLive;
                    const isManual = item.triggerType === 'manual';

                    return (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(item.detailHref)}
                      >
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={getStatusBadgeClassFromStatus(item.status, 'text-[11px]')}
                          >
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium text-sm truncate block max-w-[300px]">
                            {item.workflowName}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge
                            variant={triggerDisplay.variant}
                            className="text-[10px] gap-1 max-w-[120px] truncate"
                          >
                            <span aria-hidden="true">{triggerDisplay.icon}</span>
                            <span className="truncate">{triggerDisplay.label}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground">
                                {formatRelativeTime(item.startTime)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{formatExactTime(item.startTime)}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {formatDuration(item.duration)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {isLive && !isManual ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0} onClick={(e) => e.stopPropagation()}>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
                                    <StopCircle className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                System-triggered runs cannot be stopped
                              </TooltipContent>
                            </Tooltip>
                          ) : isLive && isManual ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              disabled={cancelRun.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelRun.mutate(item.id);
                              }}
                            >
                              {cancelRun.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <StopCircle className="h-4 w-4" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Load more */}
        {hasMore && !isLoading && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setFilter('page', String(page + 1))}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
