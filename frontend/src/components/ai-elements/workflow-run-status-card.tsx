import { useEffect, useMemo, useState } from 'react';
import { useQuery, skipToken } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { useExecutionStatus, useExecutionRun } from '@/hooks/queries/useExecutionQueries';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useChatStore } from '@/store/chatStore';
import { TERMINAL_STATUSES, type ExecutionStatus } from '@shipsec/shared';
import { cn } from '@/lib/utils';
import { executionEventsOptions } from '@/lib/executionQueryOptions';
import { queryKeys } from '@/lib/queryKeys';
import type { ExecutionLog } from '@/schemas/execution';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  OctagonX,
  XCircle,
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import type { ParsedWorkflowRunOutput } from '@/utils/workflowRunParsing';

// ─── Status presentation ───────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  pulseClass: string;
  Icon: typeof CheckCircle2;
  spinning: boolean;
}

function getStatusMeta(status: ExecutionStatus | undefined): StatusMeta {
  switch (status) {
    case 'COMPLETED':
      return {
        label: 'Completed',
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-950/50',
        borderColor: 'border-emerald-200 dark:border-emerald-800',
        pulseClass: '',
        Icon: CheckCircle2,
        spinning: false,
      };
    case 'FAILED':
      return {
        label: 'Failed',
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-50 dark:bg-red-950/50',
        borderColor: 'border-red-200 dark:border-red-800',
        pulseClass: '',
        Icon: XCircle,
        spinning: false,
      };
    case 'CANCELLED':
    case 'TERMINATED':
    case 'TIMED_OUT':
      return {
        label:
          status === 'TIMED_OUT'
            ? 'Timed Out'
            : status === 'CANCELLED'
              ? 'Cancelled'
              : 'Terminated',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-950/50',
        borderColor: 'border-amber-200 dark:border-amber-800',
        pulseClass: '',
        Icon: OctagonX,
        spinning: false,
      };
    case 'QUEUED':
      return {
        label: 'Queued',
        color: 'text-slate-600 dark:text-slate-400',
        bgColor: 'bg-slate-50 dark:bg-slate-950/50',
        borderColor: 'border-slate-200 dark:border-slate-700',
        pulseClass: 'animate-pulse',
        Icon: Clock3,
        spinning: false,
      };
    case 'AWAITING_INPUT':
      return {
        label: 'Awaiting Input',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-950/50',
        borderColor: 'border-amber-200 dark:border-amber-800',
        pulseClass: 'animate-pulse',
        Icon: Clock3,
        spinning: false,
      };
    case 'RUNNING':
    default:
      return {
        label: status === 'RUNNING' ? 'Running' : 'Starting',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-50 dark:bg-blue-950/50',
        borderColor: 'border-blue-200 dark:border-blue-800',
        pulseClass: '',
        Icon: Loader2,
        spinning: true,
      };
  }
}

// ─── Event type colors ─────────────────────────────────────────────────────

const EVENT_TYPE_COLOR: Record<string, string> = {
  STARTED: 'text-violet-500',
  PROGRESS: 'text-sky-500',
  COMPLETED: 'text-emerald-500',
  FAILED: 'text-rose-500',
  HTTP_REQUEST_SENT: 'text-cyan-500',
  HTTP_RESPONSE_RECEIVED: 'text-teal-500',
  HTTP_REQUEST_ERROR: 'text-rose-500',
  AWAITING_INPUT: 'text-amber-500',
  SKIPPED: 'text-slate-400',
};

const EVENT_ICON: Record<string, typeof CheckCircle> = {
  STARTED: CheckCircle,
  COMPLETED: CheckCircle2,
  FAILED: AlertCircle,
  AWAITING_INPUT: Clock3,
};

function getEventIcon(type: string): typeof CheckCircle {
  return EVENT_ICON[type] ?? Activity;
}

function formatElapsed(startMs: number): string {
  const elapsed = Math.max(0, Date.now() - startMs);
  if (elapsed < 1000) return `${elapsed}ms`;
  if (elapsed < 60000) return `${(elapsed / 1000).toFixed(1)}s`;
  const m = Math.floor(elapsed / 60000);
  const s = Math.floor((elapsed % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const EMPTY_EVENTS: ExecutionLog[] = [];

// ─── Main component ────────────────────────────────────────────────────────

export function WorkflowRunStatusCard({ run }: { run: ParsedWorkflowRunOutput }) {
  const { data: statusData } = useExecutionStatus(run.runId ?? null);
  const { data: runData } = useExecutionRun(run.runId ?? null);
  const setSelectedRun = useChatStore((state) => state.setSelectedRun);
  const effectiveRunId = statusData?.runId ?? run.runId;

  // Timeline store — for inspector-linked event feed
  const storeRunId = useExecutionTimelineStore((state) => state.selectedRunId);
  const allEvents = useExecutionTimelineStore((state) =>
    state.selectedRunId === effectiveRunId ? state.events : EMPTY_EVENTS,
  );
  const effectiveWorkflowId = statusData?.workflowId ?? run.workflowId;
  const effectiveStatus = (statusData?.status ?? run.status ?? 'RUNNING') as ExecutionStatus;
  const isTerminal = TERMINAL_STATUSES.includes(effectiveStatus);

  // Workflow name: prefer the full run data, fall back to parsed output
  const workflowName =
    (runData as { workflowName?: string } | undefined)?.workflowName ?? 'Workflow Run';

  const statusMeta = getStatusMeta(effectiveStatus);
  const StatusIcon = statusMeta.Icon;

  // ── Elapsed timer
  const startTimeMs = useMemo(() => {
    const t = (runData as { startTime?: string } | undefined)?.startTime;
    const s = statusData?.progress;
    void s; // consume to avoid unused warning
    return t ? new Date(t).getTime() : Date.now();
  }, [runData, statusData]);

  const [elapsed, setElapsed] = useState(() => formatElapsed(startTimeMs));
  useEffect(() => {
    if (isTerminal) {
      // Show final duration from run data if available
      const dur = (runData as { duration?: number } | undefined)?.duration;
      if (dur) {
        if (dur < 1000) setElapsed(`${dur}ms`);
        else if (dur < 60000) setElapsed(`${(dur / 1000).toFixed(1)}s`);
        else {
          const m = Math.floor(dur / 60000);
          const s = Math.floor((dur % 60000) / 1000);
          setElapsed(`${m}m ${s}s`);
        }
      }
      return;
    }
    const interval = setInterval(() => setElapsed(formatElapsed(startTimeMs)), 1000);
    return () => clearInterval(interval);
  }, [isTerminal, startTimeMs, runData]);

  // ── Progress
  const progress = statusData?.progress;
  const total = progress?.totalActions ?? 0;
  const completed = progress?.completedActions ?? 0;
  const progressPercent =
    total > 0 ? Math.min(100, (completed / total) * 100) : isTerminal ? 100 : 0;

  // ── Collapsible events section
  const [eventsExpanded, setEventsExpanded] = useState(false);

  const cardEventsQuery = useQuery({
    ...(effectiveRunId ? executionEventsOptions(effectiveRunId) : {}),
    queryKey: queryKeys.executions.events(effectiveRunId ?? ''),
    queryFn: effectiveRunId ? executionEventsOptions(effectiveRunId).queryFn : skipToken,
    enabled: false,
    refetchInterval: eventsExpanded && effectiveRunId && !isTerminal ? 2000 : false,
  });

  useEffect(() => {
    if (!eventsExpanded || !effectiveRunId) return;
    if (cardEventsQuery.isFetching || cardEventsQuery.data !== undefined) return;
    void cardEventsQuery.refetch();
  }, [
    eventsExpanded,
    effectiveRunId,
    cardEventsQuery.isFetching,
    cardEventsQuery.data,
    cardEventsQuery.refetch,
  ]);

  const fetchedEventsEnvelope = cardEventsQuery.data as { events?: ExecutionLog[] } | undefined;
  const fetchedEvents = fetchedEventsEnvelope?.events ?? [];

  const recentEvents = useMemo(() => {
    // Prefer live timeline events when this run is actively selected in inspector.
    if (storeRunId === effectiveRunId && allEvents.length > 0) {
      return allEvents.slice(-5);
    }

    const fetched = fetchedEvents
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return fetched.slice(-5);
  }, [allEvents, storeRunId, effectiveRunId, fetchedEvents]);

  const handleInspect = (e: React.MouseEvent) => {
    e.preventDefault();
    if (effectiveRunId) setSelectedRun(effectiveRunId);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-colors duration-300',
        statusMeta.borderColor,
        statusMeta.bgColor,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Animated status indicator dot */}
          <div
            className={cn(
              'relative flex items-center justify-center shrink-0 rounded-full w-7 h-7',
              'bg-background/80 border',
              statusMeta.borderColor,
            )}
          >
            <StatusIcon
              className={cn('h-3.5 w-3.5', statusMeta.color, {
                'animate-spin': statusMeta.spinning,
              })}
            />
            {!isTerminal && (
              <span
                className={cn(
                  'absolute inset-0 rounded-full border',
                  statusMeta.borderColor,
                  'animate-ping opacity-30',
                )}
              />
            )}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold truncate leading-tight">{workflowName}</p>
            <p className={cn('text-[11px] font-medium', statusMeta.color)}>{statusMeta.label}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Elapsed */}
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{elapsed}</span>
          {/* Step counter badge */}
          {total > 0 && (
            <Badge
              variant="secondary"
              className="text-[10px] font-mono tabular-nums gap-0.5 shrink-0"
            >
              {completed}/{total}
            </Badge>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3.5">
        <div className="h-1 w-full rounded-full bg-background/60 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              effectiveStatus === 'COMPLETED'
                ? 'bg-emerald-500'
                : effectiveStatus === 'FAILED'
                  ? 'bg-red-500'
                  : 'bg-blue-500',
              !isTerminal &&
                progressPercent > 0 &&
                progressPercent < 100 &&
                'relative overflow-hidden',
            )}
            style={{ width: `${progressPercent}%` }}
          >
            {/* Shimmer for in-progress */}
            {!isTerminal && progressPercent > 0 && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
            )}
          </div>
        </div>
      </div>

      {/* Mini Event Feed */}
      {effectiveRunId && (
        <div className="mt-2.5">
          <button
            onClick={() => {
              setEventsExpanded((v) => {
                const next = !v;
                if (next && !cardEventsQuery.data && !cardEventsQuery.isFetching) {
                  void cardEventsQuery.refetch();
                }
                return next;
              });
            }}
            className="flex items-center gap-1.5 w-full px-3.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Activity className="h-3 w-3" />
            <span>
              {recentEvents.length > 0
                ? `${recentEvents.length} recent events`
                : cardEventsQuery.isFetching
                  ? 'Loading events...'
                  : 'Show events'}
            </span>
            {eventsExpanded ? (
              <ChevronUp className="h-3 w-3 ml-auto" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-auto" />
            )}
          </button>

          {eventsExpanded && (
            <ul className="px-2 pb-2 space-y-0.5">
              {recentEvents.map((event) => {
                const EventIcon = getEventIcon(event.type);
                const colorClass = EVENT_TYPE_COLOR[event.type] ?? 'text-muted-foreground';
                return (
                  <li
                    key={event.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-background/60 transition-colors group"
                  >
                    <EventIcon className={cn('h-3 w-3 shrink-0', colorClass)} />
                    <span className={cn('text-[11px] font-medium shrink-0', colorClass)}>
                      {event.type}
                    </span>
                    {event.nodeId && (
                      <span className="text-[11px] text-muted-foreground truncate min-w-0">
                        {event.nodeId}
                      </span>
                    )}
                    {event.message && !event.nodeId && (
                      <span className="text-[11px] text-muted-foreground truncate min-w-0">
                        {event.message}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground/70 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </li>
                );
              })}
              {!cardEventsQuery.isFetching && recentEvents.length === 0 && (
                <li className="px-2 py-1 text-[11px] text-muted-foreground">No events yet.</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Footer actions */}
      {effectiveRunId && (
        <div
          className={cn(
            'flex items-center gap-3 px-3.5 py-2 border-t mt-1',
            statusMeta.borderColor,
            'bg-background/40',
          )}
        >
          <button
            onClick={handleInspect}
            className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold transition-colors',
              statusMeta.color,
              'hover:opacity-80',
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            Inspect Run
          </button>
          {effectiveWorkflowId && (
            <a
              href={`/workflows/${effectiveWorkflowId}/runs/${effectiveRunId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              Open full page
              <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
          {/* Run ID — truncated */}
          {!effectiveWorkflowId && effectiveRunId && (
            <span className="ml-auto text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">
              {effectiveRunId.split('-').slice(0, 3).join('-')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
