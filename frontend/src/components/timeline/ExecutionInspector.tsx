import { useEffect, useMemo, useState, useCallback } from 'react'
import { RunSelector } from '@/components/timeline/RunSelector'
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline'
import { EventInspector } from '@/components/timeline/EventInspector'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageModal } from '@/components/ui/MessageModal'
import { StopCircle, Link2 } from 'lucide-react'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useArtifactStore } from '@/store/artifactStore'
import { useToast } from '@/components/ui/use-toast'
import { useRunStore } from '@/store/runStore'
import { cn } from '@/lib/utils'
import type { ExecutionLog } from '@/schemas/execution'
import { RunArtifactsPanel } from '@/components/artifacts/RunArtifactsPanel'
import { AgentTracePanel } from '@/components/timeline/AgentTracePanel'

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

const formatStructured = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    console.error('Failed to stringify structured log data', error)
    return String(value)
  }
}

const buildLogMessage = (log: ExecutionLog): string => {
  const sections: string[] = []

  const primaryMessage = (log.message ?? log.error?.message)?.trim()
  sections.push(primaryMessage && primaryMessage.length > 0 ? primaryMessage : log.type)

  if (log.outputSummary && Object.keys(log.outputSummary).length > 0) {
    sections.push(`Output summary:\n${formatStructured(log.outputSummary)}`)
  }

  if (log.data && Object.keys(log.data).length > 0) {
    sections.push(`Data:\n${formatStructured(log.data)}`)
  }

  if (log.error?.stack?.trim()) {
    sections.push(`Stack trace:\n${log.error.stack.trim()}`)
  }

  return sections.join('\n\n').trim()
}

const LOG_LEVEL_OPTIONS = ['all', 'error', 'warn', 'info', 'debug'] as const
type LogLevelFilter = (typeof LOG_LEVEL_OPTIONS)[number]
const LOG_LEVEL_LABELS: Record<LogLevelFilter, string> = {
  all: 'All',
  error: 'Error',
  warn: 'Warn',
  info: 'Info',
  debug: 'Debug',
}
const LOG_LEVEL_TONES: Record<string, { text: string; accent: string }> = {
  error: { text: 'text-red-300', accent: 'border-red-400/60 bg-red-400/10' },
  warn: { text: 'text-amber-200', accent: 'border-amber-300/60 bg-amber-300/10' },
  info: { text: 'text-sky-200', accent: 'border-sky-300/60 bg-sky-300/10' },
  debug: { text: 'text-slate-300', accent: 'border-slate-300/60 bg-slate-200/10' },
  default: { text: 'text-slate-200', accent: 'border-slate-400/40 bg-slate-700/20' },
}
const LOG_LEVEL_ORDER: Record<Exclude<LogLevelFilter, 'all'>, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}
const normalizeLevel = (level?: string | null) => (level ?? '').toLowerCase()
const getLogLevelTone = (level?: string | null) => {
  const normalized = normalizeLevel(level)
  return LOG_LEVEL_TONES[normalized] ?? LOG_LEVEL_TONES.default
}

interface ExecutionInspectorProps {
  onRerunRun?: (runId: string) => void
}

export function ExecutionInspector({ onRerunRun }: ExecutionInspectorProps = {}) {
  const {
    selectedRunId,
    playbackMode,
    isPlaying,
  } = useExecutionTimelineStore()
  const { id: workflowId, currentVersion: currentWorkflowVersion } = useWorkflowStore(
    (state) => state.metadata
  )
  const workflowCacheKey = workflowId ?? '__global__'
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs)
  const runs = scopedRuns ?? []
  const { status, runStatus, stopExecution, runId: liveRunId } = useWorkflowExecution()
  const { inspectorTab, setInspectorTab } = useWorkflowUiStore()
  const fetchRunArtifacts = useArtifactStore((state) => state.fetchRunArtifacts)
  const { getDisplayLogs, setLogMode } = useExecutionStore()
  const [logModal, setLogModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: '',
  })
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('all')
  const rawLogs = getDisplayLogs()
  const filteredLogs = useMemo(() => {
    if (logLevelFilter === 'all') {
      return rawLogs
    }
    const threshold = LOG_LEVEL_ORDER[logLevelFilter]
    return rawLogs.filter((log) => {
      const normalized = normalizeLevel(log.level)
      const value = LOG_LEVEL_ORDER[normalized as keyof typeof LOG_LEVEL_ORDER] ?? LOG_LEVEL_ORDER.debug
      return value <= threshold
    })
  }, [rawLogs, logLevelFilter])
  const { toast } = useToast()

  const selectedRun = useMemo(() => (
    runs.find(run => run.id === selectedRunId)
  ), [runs, selectedRunId])

  const handleCopyLink = useCallback(async () => {
    if (!selectedRun) return
    const basePath = `/workflows/${selectedRun.workflowId}/runs/${selectedRun.id}`
    const absoluteUrl = typeof window !== 'undefined' ? `${window.location.origin}${basePath}` : basePath
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl)
        toast({
          title: 'Run link copied',
          description: 'Share this URL to open the execution directly.',
        })
      } else {
        throw new Error('Clipboard API is unavailable')
      }
    } catch (error) {
      console.error('Failed to copy run link:', error)
      toast({
        variant: 'destructive',
        title: 'Unable to copy link automatically',
        description: absoluteUrl,
      })
    }
  }, [selectedRun, toast])

  useEffect(() => {
    if (selectedRunId && inspectorTab === 'artifacts') {
      void fetchRunArtifacts(selectedRunId)
    }
  }, [selectedRunId, inspectorTab, fetchRunArtifacts])

  useEffect(() => {
    // Switch log mode based on timeline playback mode
    if (playbackMode === 'live') {
      setLogMode('live')
    } else if (playbackMode === 'replay') {
      setLogMode('scrubbing')
    }
  }, [playbackMode, setLogMode])



  const openLogModal = (fullMessage: string, log: ExecutionLog) => {
    const titleParts = [
      'Log message',
      log.nodeId ? `Node ${log.nodeId}` : null,
      formatTime(log.timestamp),
    ].filter(Boolean)

    setLogModal({
      open: true,
      message: fullMessage,
      title: titleParts.join(' • '),
    })
  }

  const getStatusLabel = (status: string) => {
    if (status === 'TERMINATED') return 'STOPPED'
    return status.toUpperCase()
  }

  const statusBadge = selectedRun ? (
    <Badge
      variant={selectedRun.status === 'RUNNING' ? 'default' : selectedRun.status === 'FAILED' ? 'destructive' : 'secondary'}
      className="text-xs"
    >
      {getStatusLabel(selectedRun.status)}
    </Badge>
  ) : null
  const runVersion = typeof selectedRun?.workflowVersion === 'number' ? selectedRun.workflowVersion : null
  const versionMismatch =
    runVersion !== null &&
    typeof currentWorkflowVersion === 'number' &&
    runVersion !== currentWorkflowVersion
  const versionBadge = runVersion !== null ? (
    <Badge
      variant={versionMismatch ? 'outline' : 'secondary'}
      className={cn(
        'text-[10px] uppercase tracking-wide',
        versionMismatch && 'border-amber-300 bg-amber-50 text-amber-700'
      )}
    >
      v{runVersion}
    </Badge>
  ) : null

  return (
    <>
      <aside className="flex h-full min-h-0 w-full min-w-[320px] flex-col overflow-hidden border-l bg-muted/30 backdrop-blur">
        <div className="border-b p-3 space-y-3 bg-background/70">
          <div className="flex items-center justify-between gap-2">
            <RunSelector onRerun={onRerunRun} />

            <div className="flex items-center gap-2">
              {runStatus?.progress && selectedRunId === liveRunId && (status === 'running' || status === 'queued') && (
                <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                  {runStatus.progress.completedActions}/{runStatus.progress.totalActions} actions
                </span>
              )}

              {selectedRunId === liveRunId && (status === 'running' || status === 'queued') && (
                <Button
                  onClick={() => stopExecution()}
                  variant="destructive"
                  size="sm"
                  className="h-8 px-2 gap-1.5"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  <span className="text-xs">Stop</span>
                </Button>
              )}
            </div>
          </div>
          {selectedRun && (
            <div className="rounded-md border bg-background px-3 py-2 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm truncate">{selectedRun.workflowName}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCopyLink}
                    title="Copy run link"
                    aria-label="Copy direct link to this run"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                  {versionBadge}
                  {statusBadge}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                <span>Run #{selectedRun.id.slice(-6)}</span>
                {selectedRun.duration && <span>{Math.round(selectedRun.duration / 1000)}s</span>}
                <span>{selectedRun.eventCount} events</span>
                {selectedRun.nodeCount > 0 && <span>{selectedRun.nodeCount} nodes</span>}
                {runVersion !== null && (
                  <span className={cn(versionMismatch ? 'text-amber-500' : undefined)}>
                    v{runVersion}
                    {versionMismatch && typeof currentWorkflowVersion === 'number'
                      ? ` (current v${currentWorkflowVersion})`
                      : ''}
                  </span>
                )}
              </div>
            </div>
          )}
          {!selectedRun && (
            <div className="rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
              Select a run to explore its timeline.
            </div>
          )}
        </div>

        <div className="border-b bg-background/60 flex-shrink-0">
          {selectedRun ? (
            <ExecutionTimeline />
          ) : (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Select a run to scrub through execution timelines.
            </div>
          )}
        </div>

        <div className="border-b bg-background/60 px-3 py-2 flex items-center justify-between gap-3">
          <div className="inline-flex rounded-md border bg-muted/60 p-1 text-xs font-medium">
            <Button
              variant={inspectorTab === 'events' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setInspectorTab('events')}
            >
              Events
            </Button>
            <Button
              variant={inspectorTab === 'logs' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setInspectorTab('logs')}
            >
              Logs
            </Button>
            <Button
              variant={inspectorTab === 'agent' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setInspectorTab('agent')}
            >
              Agent Trace
            </Button>
            <Button
              variant={inspectorTab === 'artifacts' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setInspectorTab('artifacts')}
            >
              Artifacts
            </Button>
          </div>
          {inspectorTab === 'logs' && (
            <div className="flex flex-col text-right">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Display up to level
              </span>
              <select
                value={logLevelFilter}
                onChange={(event) => setLogLevelFilter(event.target.value as LogLevelFilter)}
                className="mt-1 h-8 rounded-md border bg-background px-2 text-xs"
              >
                {LOG_LEVEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {LOG_LEVEL_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0">
          {inspectorTab === 'events' && (
            <div className="flex flex-col h-full min-h-0">
              <EventInspector className="h-full" />
            </div>
          )}

          {inspectorTab === 'logs' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background/70 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{`${filteredLogs.length} log entries`}</span>
                </div>
                <span className={cn('font-medium', playbackMode === 'live' ? 'text-green-600' : 'text-blue-600')}>
                  {playbackMode === 'live' ? (isPlaying ? 'Live (following)' : 'Live paused') : 'Execution playback'}
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
                      const executionLog = log as ExecutionLog
                      const fullMessage = buildLogMessage(executionLog)
                      const time = formatTime(log.timestamp)
                      const level = (log.level ?? '').toUpperCase()
                      const node = log.nodeId ? `[${log.nodeId}]` : ''

                      // Color coding for log levels
                      // Check for JSON and format nicely
                      let displayMessage = fullMessage
                      let isJson = false
                      try {
                        const parsed = JSON.parse(fullMessage.trim())
                        if (typeof parsed === 'object' && parsed !== null) {
                          displayMessage = JSON.stringify(parsed, null, 2)
                          isJson = true
                        }
                      } catch {
                        // Not JSON, use as-is
                      }

                      // Truncate long messages
                      const maxLength = 150
                      const isTruncated = displayMessage.length > maxLength
                      const truncatedMessage = isTruncated
                        ? displayMessage.substring(0, maxLength) + '...'
                        : displayMessage

                      const tone = getLogLevelTone(log.level)

                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'group cursor-pointer rounded border-l-2 px-2 py-1 leading-none transition-colors',
                            tone.accent,
                            'hover:bg-white/5'
                          )}
                          onClick={() => openLogModal(fullMessage, executionLog)}
                        >
                          <div className="flex items-start gap-1">
                            <span className={cn('text-[10px] font-mono flex-shrink-0 w-12', tone.text)}>
                              {time}
                            </span>
                            <span className={cn('text-[10px] font-bold uppercase flex-shrink-0 w-12', tone.text)}>
                              {level}
                            </span>
                            {node && (
                              <span className={cn('text-[10px] flex-shrink-0 max-w-16 truncate', tone.text)}>
                                {node}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <pre
                                  className={cn(
                                    'text-[11px] leading-tight flex-1',
                                    tone.text,
                                    isJson ? 'whitespace-pre-wrap' : 'whitespace-nowrap overflow-hidden text-ellipsis'
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
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {inspectorTab === 'artifacts' && (
            <RunArtifactsPanel runId={selectedRunId ?? null} />
          )}

          {inspectorTab === 'agent' && (
            <AgentTracePanel runId={selectedRunId ?? null} />
          )}
        </div>
      </aside>
      <MessageModal
        open={logModal.open}
        onOpenChange={(open) => setLogModal((prev) => ({ ...prev, open }))}
        title={logModal.title || 'Log message'}
        message={logModal.message}
      />
    </>
  )
}
