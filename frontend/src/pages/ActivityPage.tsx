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
import {
  StopCircle,
  Search,
  CalendarClock,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  AlertTriangle,
  MessageSquare,
  Clock,
  Activity,
  ExternalLink,
  Copy,
  Check,
  Workflow,
  Container,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useActivityRuns, useCancelRun } from '@/hooks/queries/useActivityQueries';
import { useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { getTriggerDisplay } from '@/utils/triggerDisplay';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { formatRelativeTime, formatExactTime } from '@/components/scans/scan-utils';
import type { ExecutionTriggerType, ExecutionInputPreview } from '@shipsec/shared';

type StatusTab = 'all' | 'running' | 'completed' | 'failed';

const STATUS_TAB_MAP: Record<StatusTab, string | undefined> = {
  all: undefined,
  running: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

// Status → Lucide icon mapping
const STATUS_ICON_MAP: Record<string, { icon: LucideIcon; spin?: boolean }> = {
  RUNNING: { icon: Loader2, spin: true },
  QUEUED: { icon: Clock },
  COMPLETED: { icon: CheckCircle2 },
  FAILED: { icon: XCircle },
  CANCELLED: { icon: Ban },
  TERMINATED: { icon: Ban },
  TIMED_OUT: { icon: AlertTriangle },
  AWAITING_INPUT: { icon: MessageSquare },
  STALE: { icon: AlertTriangle },
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

function RunId({ runId, detailHref }: { runId: string; detailHref: string }) {
  const [copied, setCopied] = useState(false);
  const runUrl = `${window.location.origin}${detailHref}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(runUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground/70 hover:text-muted-foreground transition-colors max-w-[220px]"
        >
          <span className="truncate">{runId}</span>
          {copied ? (
            <Check className="h-2.5 w-2.5 text-green-500 flex-shrink-0" />
          ) : (
            <Copy className="h-2.5 w-2.5 opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <span className="font-mono">{runId}</span>
        <span className="block text-[10px] text-muted-foreground mt-0.5">
          Click to copy run URL
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

// --- Provider / scan context detection ---

const PROVIDER_LOGO: Record<string, { src: string; alt: string }> = {
  github: { src: '/icons/github.svg', alt: 'GitHub' },
  aws: { src: '/icons/aws.svg', alt: 'AWS' },
};

type ContainerRegistry = 'dockerhub' | 'ghcr' | 'ecr';

const REGISTRY_LOGO: Record<ContainerRegistry, { src: string; alt: string }> = {
  dockerhub: { src: '/icons/docker.svg', alt: 'Docker Hub' },
  ghcr: { src: '/icons/github.svg', alt: 'GHCR' },
  ecr: { src: '/icons/aws.svg', alt: 'AWS ECR' },
};

function isCloudWorkflow(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('prowler') || lower.includes('cloud') || lower.includes('cspm');
}

function detectContainerRegistry(imageRef: string): ContainerRegistry {
  const ref = imageRef.toLowerCase();
  if (ref.startsWith('ghcr.io/')) return 'ghcr';
  if (/\.dkr\.ecr\.[^.]+\.amazonaws\.com\//.test(ref)) return 'ecr';
  return 'dockerhub';
}

interface ScanContext {
  provider: 'aws' | 'github' | 'workflow';
  containerRegistry?: ContainerRegistry;
  targetLabel?: string;
}

function getScanContext(
  workflowName: string,
  inputPreview: ExecutionInputPreview,
  connectionNameMap?: Map<string, string>,
): ScanContext {
  const runtimeInputs = inputPreview?.runtimeInputs ?? {};
  const imageRef = typeof runtimeInputs.imageRef === 'string' ? runtimeInputs.imageRef : undefined;

  if (imageRef) {
    const registry = detectContainerRegistry(imageRef);
    return {
      provider: 'workflow',
      containerRegistry: registry,
      targetLabel: imageRef,
    };
  }

  if (isCloudWorkflow(workflowName)) {
    const connectionId =
      typeof runtimeInputs.connectionId === 'string' ? runtimeInputs.connectionId : undefined;
    const connectionName = connectionId && connectionNameMap?.get(connectionId);
    return {
      provider: 'aws',
      targetLabel: connectionName || (connectionId ? connectionId.slice(0, 8) : undefined),
    };
  }

  // GitHub-related scans — extract repo from runtimeInputs
  const repo = typeof runtimeInputs.repository === 'string' ? runtimeInputs.repository : undefined;
  const branch = typeof runtimeInputs.branch === 'string' ? runtimeInputs.branch : undefined;

  const lower = workflowName.toLowerCase();
  if (
    lower.includes('secret') ||
    lower.includes('sast') ||
    lower.includes('dependency') ||
    lower.includes('code')
  ) {
    return {
      provider: 'github',
      targetLabel: repo ? (branch ? `${repo} (${branch})` : repo) : undefined,
    };
  }

  return { provider: 'workflow' };
}

function ScanContextIcon({ context }: { context: ScanContext }) {
  if (context.containerRegistry) {
    const logo = REGISTRY_LOGO[context.containerRegistry];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative w-7 h-7 flex-shrink-0 cursor-default">
            <img src={logo.src} alt={logo.alt} className="w-7 h-7 rounded object-contain p-0.5" />
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-background border flex items-center justify-center">
              <Container className="h-2 w-2 text-muted-foreground" />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="font-medium">{logo.alt}</span>
          {context.targetLabel && (
            <span className="block text-[10px] text-muted-foreground font-mono mt-0.5 max-w-[250px] truncate">
              {context.targetLabel}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (context.provider === 'aws' || context.provider === 'github') {
    const logo = PROVIDER_LOGO[context.provider];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <img
            src={logo.src}
            alt={logo.alt}
            className="w-7 h-7 rounded object-contain p-0.5 flex-shrink-0 cursor-default"
          />
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="font-medium">{logo.alt}</span>
          {context.targetLabel && (
            <span className="block text-[10px] text-muted-foreground font-mono mt-0.5">
              {context.targetLabel}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Generic workflow
  return (
    <div className="w-7 h-7 rounded bg-muted/50 flex items-center justify-center flex-shrink-0">
      <Workflow className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_ICON_MAP[status] ?? STATUS_ICON_MAP.COMPLETED;
  const Icon = meta.icon;

  return (
    <Badge variant="outline" className={getStatusBadgeClassFromStatus(status, 'text-[11px] gap-1')}>
      <Icon className={`h-3 w-3 ${meta.spin ? 'animate-spin' : ''}`} />
      {status}
    </Badge>
  );
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
  const { data: connections } = useIntegrationConnections();

  const connectionNameMap = useMemo(() => {
    if (!connections) return new Map<string, string>();
    return new Map(connections.map((c) => [c.id, c.displayName ?? c.providerName]));
  }, [connections]);

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
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[130px]">Status</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead className="hidden md:table-cell">Target</TableHead>
                  <TableHead className="hidden lg:table-cell w-[150px]">Trigger</TableHead>
                  <TableHead className="hidden xl:table-cell w-[130px]">Started</TableHead>
                  <TableHead className="hidden xl:table-cell w-[90px]">Duration</TableHead>
                  <TableHead className="w-[70px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Skeleton className="h-5 w-24" />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-4 w-12" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-7 w-7" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Activity className="h-8 w-8 opacity-40" />
                        <p className="text-sm font-medium">
                          {searchQuery || triggerFilter || statusTab !== 'all'
                            ? 'No runs match your filters'
                            : 'No activity yet'}
                        </p>
                        <p className="text-xs">
                          {searchQuery || triggerFilter || statusTab !== 'all'
                            ? 'Try adjusting your search or filters'
                            : 'Run a workflow to see execution history here'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const triggerDisplay = getTriggerDisplay(item.triggerType, item.triggerLabel);
                    const isLive = item.isLive;
                    const isManual = item.triggerType === 'manual';
                    const TriggerIcon = triggerDisplay.icon;
                    const scanContext = getScanContext(
                      item.workflowName,
                      item.inputPreview,
                      connectionNameMap,
                    );

                    return (
                      <TableRow
                        key={item.id}
                        className="group/row cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => navigate(item.detailHref)}
                      >
                        <TableCell>
                          <StatusBadge status={item.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2.5">
                            <ScanContextIcon context={scanContext} />
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-medium text-sm truncate max-w-[280px]">
                                {item.workflowName}
                              </span>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                                <RunId runId={item.id} detailHref={item.detailHref} />
                                {item.nodeCount > 0 && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span>{item.nodeCount} nodes</span>
                                  </>
                                )}
                                {item.eventCount > 0 && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span>{item.eventCount} events</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {scanContext.targetLabel ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm text-muted-foreground truncate block max-w-[200px]">
                                  {scanContext.targetLabel}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[300px] break-all">
                                {scanContext.targetLabel}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-sm text-muted-foreground/40">-</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={triggerDisplay.variant}
                                className="text-[10px] gap-1 max-w-[140px] cursor-default"
                              >
                                <TriggerIcon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                                <span className="truncate">{triggerDisplay.label}</span>
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top">{triggerDisplay.label}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground">
                                {formatRelativeTime(item.startTime)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{formatExactTime(item.startTime)}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <div className="flex items-center gap-1.5">
                            {isLive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                            )}
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {formatDuration(item.duration)}
                            </span>
                          </div>
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
                            <Tooltip>
                              <TooltipTrigger asChild>
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
                              </TooltipTrigger>
                              <TooltipContent>Stop this run</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 opacity-0 group-hover/row:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(item.detailHref);
                                  }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View run details</TooltipContent>
                            </Tooltip>
                          )}
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
