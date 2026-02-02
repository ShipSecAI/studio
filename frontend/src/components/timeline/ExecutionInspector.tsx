import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { RunSelector } from '@/components/timeline/RunSelector';
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline';
import { EventInspector } from '@/components/timeline/EventInspector';
import { Button } from '@/components/ui/button';
import { MessageModal } from '@/components/ui/MessageModal';
import { StopCircle, RefreshCw, Link2, Globe } from 'lucide-react';

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { useArtifactStore } from '@/store/artifactStore';
import { useToast } from '@/components/ui/use-toast';
import { useRunStore, type ExecutionRun } from '@/store/runStore';
import { cn } from '@/lib/utils';
import type { ExecutionLog } from '@/schemas/execution';
import { RunArtifactsPanel } from '@/components/artifacts/RunArtifactsPanel';
import { AgentTracePanel } from '@/components/timeline/AgentTracePanel';
import { NodeIOInspector } from '@/components/timeline/NodeIOInspector';
import { NetworkPanel } from '@/components/timeline/NetworkPanel';
import { getTriggerDisplay } from '@/utils/triggerDisplay';
import { RunInfoDisplay } from '@/components/timeline/RunInfoDisplay';

const TERMINAL_STATUSES: ExecutionRun['status'][] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
];

const isRunLive = (run?: ExecutionRun | null) => {
  if (!run) return false;
  if (run.isLive) return true;
  return !TERMINAL_STATUSES.includes(run.status);
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

const formatStructured = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error('Failed to stringify structured log data', error);
    return String(value);
  }
};

const buildLogMessage = (log: ExecutionLog): string => {
  const sections: string[] = [];

  const primaryMessage = (log.message ?? log.error?.message)?.trim();
  sections.push(primaryMessage && primaryMessage.length > 0 ? primaryMessage : log.type);

  if (log.outputSummary && Object.keys(log.outputSummary).length > 0) {
    sections.push(`Output summary:\n${formatStructured(log.outputSummary)}`);
  }

  if (log.data && Object.keys(log.data).length > 0) {
    sections.push(`Data:\n${formatStructured(log.data)}`);
  }

  if (log.error?.stack?.trim()) {
    sections.push(`Stack trace:\n${log.error.stack.trim()}`);
  }

  return sections.join('\n\n').trim();
};

const LOG_LEVEL_OPTIONS = ['all', 'error', 'warn', 'info', 'debug'] as const;
type LogLevelFilter = (typeof LOG_LEVEL_OPTIONS)[number];
const LOG_LEVEL_LABELS: Record<LogLevelFilter, string> = {
  all: 'All',
  error: 'Error',
  warn: 'Warn',
  info: 'Info',
  debug: 'Debug',
};
const LOG_LEVEL_TONES: Record<string, { text: string; accent: string }> = {
  error: { text: 'text-red-300', accent: 'border-red-400/60 bg-red-400/10' },
  warn: { text: 'text-amber-200', accent: 'border-amber-300/60 bg-amber-300/10' },
  info: { text: 'text-sky-200', accent: 'border-sky-300/60 bg-sky-300/10' },
  debug: { text: 'text-slate-300', accent: 'border-slate-300/60 bg-slate-200/10' },
  default: { text: 'text-slate-200', accent: 'border-slate-400/40 bg-slate-700/20' },
};
const LOG_LEVEL_ORDER: Record<Exclude<LogLevelFilter, 'all'>, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};
const normalizeLevel = (level?: string | null) => (level ?? '').toLowerCase();
const getLogLevelTone = (level?: string | null) => {
  const normalized = normalizeLevel(level);
  return LOG_LEVEL_TONES[normalized] ?? LOG_LEVEL_TONES.default;
};

interface ExecutionInspectorProps {
  onRerunRun?: (runId: string) => void;
}

const MIN_TIMELINE_HEIGHT = 10;
const MAX_TIMELINE_HEIGHT = 320;
const DEFAULT_TIMELINE_HEIGHT = 320;

export function ExecutionInspector({ onRerunRun }: ExecutionInspectorProps = {}) {
  const { selectedRunId, playbackMode, isPlaying } = useExecutionTimelineStore();
  const { id: workflowId, currentVersion: currentWorkflowVersion } = useWorkflowStore(
    (state) => state.metadata,
  );
  const workflowCacheKey = workflowId ?? '__global__';
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs);
  const runs = scopedRuns ?? [];
  const { status, runStatus, stopExecution, runId: liveRunId } = useWorkflowExecution();
  const { inspectorTab, setInspectorTab } = useWorkflowUiStore();
  const fetchRunArtifacts = useArtifactStore((state) => state.fetchRunArtifacts);
  const { getDisplayLogs, setLogMode } = useExecutionStore();
  const [logModal, setLogModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: '',
  });
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('all');
  const [timelineHeight, setTimelineHeight] = useState(DEFAULT_TIMELINE_HEIGHT);
  const isResizingTimeline = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rawLogs = getDisplayLogs();

  // Vertical resize handlers for timeline section
  const handleTimelineResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isResizingTimeline.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMove = (clientY: number) => {
      if (!isResizingTimeline.current || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const newHeight = clientY - rect.top;
      const clampedHeight = Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, newHeight));
      setTimelineHeight(clampedHeight);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleMove(touch.clientY);
    };

    const handleEnd = () => {
      isResizingTimeline.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, []);
  const filteredLogs = useMemo(() => {
    if (logLevelFilter === 'all') {
      return rawLogs;
    }
    const threshold = LOG_LEVEL_ORDER[logLevelFilter];
    return rawLogs.filter((log) => {
      const normalized = normalizeLevel(log.level);
      const value =
        LOG_LEVEL_ORDER[normalized as keyof typeof LOG_LEVEL_ORDER] ?? LOG_LEVEL_ORDER.debug;
      return value <= threshold;
    });
  }, [rawLogs, logLevelFilter]);
  const { toast } = useToast();

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId),
    [runs, selectedRunId],
  );
  const triggerDisplay = selectedRun
    ? getTriggerDisplay(selectedRun.triggerType, selectedRun.triggerLabel)
    : null;

  const handleCopyLink = useCallback(async () => {
    if (!selectedRun) return;
    const basePath = `/workflows/${selectedRun.workflowId}/runs/${selectedRun.id}`;
    const absoluteUrl =
      typeof window !== 'undefined' ? `${window.location.origin}${basePath}` : basePath;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
        toast({
          title: 'Run link copied',
          description: 'Share this URL to open the execution directly.',
        });
      } else {
        throw new Error('Clipboard API is unavailable');
      }
    } catch (error) {
      console.error('Failed to copy run link:', error);
      toast({
        variant: 'destructive',
        title: 'Unable to copy link automatically',
        description: absoluteUrl,
      });
    }
  }, [selectedRun, toast]);

  useEffect(() => {
    if (selectedRunId && inspectorTab === 'artifacts') {
      void fetchRunArtifacts(selectedRunId);
    }
  }, [selectedRunId, inspectorTab, fetchRunArtifacts]);

  useEffect(() => {
    // Switch log mode based on timeline playback mode
    if (playbackMode === 'live') {
      setLogMode('live');
    } else if (playbackMode === 'replay') {
      // For replay mode, use historical logs initially (scrubbing mode is only for timeline scrubbing)
      setLogMode('historical');
    }
  }, [playbackMode, setLogMode]);

  const openLogModal = (fullMessage: string, log: ExecutionLog) => {
    const titleParts = [
      'Log message',
      log.nodeId ? `Node ${log.nodeId}` : null,
      formatTime(log.timestamp),
    ].filter(Boolean);

    setLogModal({
      open: true,
      message: fullMessage,
      title: titleParts.join(' • '),
    });
  };

  const isMobile = useIsMobile();
  return (
    <>
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        {/* Header - Run Selector */}
        <div className="border-b px-3 py-2.5 flex items-center justify-between gap-2">
          <RunSelector onRerun={onRerunRun} />
          <div className="flex items-center gap-2">
            {runStatus?.progress &&
              selectedRunId === liveRunId &&
              (status === 'running' || status === 'queued') && (
                <span className="text-[11px] text-muted-foreground font-medium">
                  {runStatus.progress.completedActions}/{runStatus.progress.totalActions}
                </span>
              )}
            {selectedRunId === liveRunId && (status === 'running' || status === 'queued') && (
              <Button
                onClick={() => stopExecution()}
                variant="destructive"
                size="sm"
                className="h-7 px-2 gap-1"
              >
                <StopCircle className="h-3.5 w-3.5 md:h-3 md:w-3" />
                {!isMobile && <span className="text-xs">Stop</span>}
              </Button>
            )}
          </div>
        </div>

        {/* Run Info - Compact */}
        {selectedRun && (
          <div className="px-3 py-2.5 border-b">
            <div className="rounded-lg border bg-card p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-medium text-sm truncate font-mono" title={selectedRun.id}>
                  {selectedRun.id.split('-').slice(0, 3).join('-')}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={handleCopyLink}
                    title="Copy run link"
                  >
                    <Link2 className="h-3 w-3" />
                  </Button>
                  {onRerunRun && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 gap-1.5"
                      disabled={isRunLive(selectedRun)}
                      title={
                        isRunLive(selectedRun) ? 'Wait for run to complete' : 'Rerun this workflow'
                      }
                      onClick={() => onRerunRun(selectedRun.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rerun
                    </Button>
                  )}
                </div>
              </div>
              <RunInfoDisplay
                run={selectedRun}
                currentWorkflowVersion={currentWorkflowVersion}
                showBadges={true}
              />
            </div>
          </div>
        )}
        {!selectedRun && (
          <div className="px-3 py-4 border-b text-xs text-muted-foreground text-center">
            Select a run to explore
          </div>
        )}

        {/* Timeline - Vertically Resizable */}
        <div
          ref={timelineRef}
          className="flex-shrink-0 relative"
          style={{ height: timelineHeight }}
        >
          {selectedRun ? (
            <div className="h-full overflow-hidden">
              <ExecutionTimeline />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Select a run to view timeline
            </div>
          )}
          {/* Vertical Resize Handle - More visible */}
          <div
            onMouseDown={handleTimelineResizeStart}
            onTouchStart={handleTimelineResizeStart}
            className="absolute bottom-0 left-0 right-0 h-3 cursor-row-resize group z-10 flex items-center justify-center touch-none"
          >
            <div className="w-12 h-1 rounded-full bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
          </div>
        </div>
        <div className="border-b" />

        {/* Tabs */}
        <div className="border-b px-3 py-2 flex items-center justify-between gap-2 bg-muted/20">
          <div className="inline-flex rounded-md border bg-background p-0.5 text-xs">
            <Button
              variant={inspectorTab === 'events' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setInspectorTab('events')}
            >
              Events
            </Button>
            <Button
              variant={inspectorTab === 'logs' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setInspectorTab('logs')}
            >
              Logs
            </Button>
            <Button
              variant={inspectorTab === 'agent' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setInspectorTab('agent')}
            >
              Agent
            </Button>
            <Button
              variant={inspectorTab === 'artifacts' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setInspectorTab('artifacts')}
            >
              Artifacts
            </Button>
            <Button
              variant={inspectorTab === 'io' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setInspectorTab('io')}
            >
              I/O
            </Button>
            <Button
              variant={inspectorTab === 'network' ? 'default' : 'ghost'}
              size="sm"
              className="h-6 px-2.5 text-xs gap-1"
              onClick={() => setInspectorTab('network')}
            >
              <Globe className="h-3 w-3" />
              Network
            </Button>
          </div>
          {inspectorTab === 'logs' && (
            <select
              value={logLevelFilter}
              onChange={(event) => setLogLevelFilter(event.target.value as LogLevelFilter)}
              className="h-6 rounded border bg-background px-1.5 text-[11px]"
            >
              {LOG_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {LOG_LEVEL_LABELS[option]}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {inspectorTab === 'events' && (
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              <EventInspector className="h-full" />
            </div>
          )}

          {inspectorTab === 'logs' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background/70 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{`${filteredLogs.length} log entries`}</span>
                  {triggerDisplay && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
                      <span aria-hidden="true">{triggerDisplay.icon}</span>
                      Triggered by {triggerDisplay.label}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'font-medium',
                    playbackMode === 'live' ? 'text-green-600' : 'text-blue-600',
                  )}
                >
                  {playbackMode === 'live'
                    ? isPlaying
                      ? 'Live (following)'
                      : 'Live paused'
                    : 'Execution playback'}
                </span>
              </div>
              <div className="flex-1 overflow-auto bg-slate-950 text-slate-100 font-mono text-xs">
                {filteredLogs.length === 0 ? (
                  <div className="text-slate-400 text-center py-8">
                    {rawLogs.length === 0
                      ? 'No logs to display for this run.'
                      : 'No logs match the selected filter.'}
                  </div>
                ) : (
                  <div className="p-2 space-y-0 min-w-max">
                    {filteredLogs.map((log) => {
                      const executionLog = log as ExecutionLog;
                      const fullMessage = buildLogMessage(executionLog);
                      const time = formatTime(log.timestamp);
                      const level = (log.level ?? '').toUpperCase();
                      const node = log.nodeId ? `[${log.nodeId}]` : '';

                      // Color coding for log levels
                      // Check for JSON and format nicely
                      let displayMessage = fullMessage;
                      let isJson = false;
                      try {
                        const parsed = JSON.parse(fullMessage.trim());
                        if (typeof parsed === 'object' && parsed !== null) {
                          displayMessage = JSON.stringify(parsed, null, 2);
                          isJson = true;
                        }
                      } catch {
                        // Not JSON, use as-is
                      }

                      // Truncate long messages
                      const maxLength = 150;
                      const isTruncated = displayMessage.length > maxLength;
                      const truncatedMessage = isTruncated
                        ? displayMessage.substring(0, maxLength) + '...'
                        : displayMessage;

                      const tone = getLogLevelTone(log.level);

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'group cursor-pointer rounded border-l-2 px-2 py-1 leading-none transition-colors',
                            tone.accent,
                            'hover:bg-white/5',
                          )}
                          onClick={() => openLogModal(fullMessage, executionLog)}
                        >
                          <div className="flex items-start gap-1">
                            <span
                              className={cn('text-[10px] font-mono flex-shrink-0 w-12', tone.text)}
                            >
                              {time}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-bold uppercase flex-shrink-0 w-12',
                                tone.text,
                              )}
                            >
                              {level}
                            </span>
                            {node && (
                              <span
                                className={cn(
                                  'text-[10px] flex-shrink-0 max-w-16 truncate',
                                  tone.text,
                                )}
                              >
                                {node}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <pre
                                  className={cn(
                                    'text-[11px] leading-tight flex-1',
                                    tone.text,
                                    isJson
                                      ? 'whitespace-pre-wrap'
                                      : 'whitespace-nowrap overflow-hidden text-ellipsis',
                                  )}
                                >
                                  {truncatedMessage}
                                </pre>
                                {isTruncated && (
                                  <span className="text-slate-400 text-[9px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    ⋯
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {inspectorTab === 'artifacts' && <RunArtifactsPanel runId={selectedRunId ?? null} />}

          {inspectorTab === 'agent' && <AgentTracePanel runId={selectedRunId ?? null} />}

          {inspectorTab === 'io' && <NodeIOInspector />}

          {inspectorTab === 'network' && <NetworkPanel />}
        </div>
      </aside>
      <MessageModal
        open={logModal.open}
        onOpenChange={(open) => setLogModal((prev) => ({ ...prev, open }))}
        title={logModal.title || 'Log message'}
        message={logModal.message}
      />
    </>
  );
}
