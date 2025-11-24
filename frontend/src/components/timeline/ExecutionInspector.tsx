import { useEffect, useMemo, useState } from 'react'
import { AnsiUp } from 'ansi_up'
import { RunSelector } from '@/components/timeline/RunSelector'
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline'
import { EventInspector } from '@/components/timeline/EventInspector'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageModal } from '@/components/ui/MessageModal'
import { StopCircle } from 'lucide-react'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowExecution } from '@/hooks/useWorkflowExecution'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useArtifactStore } from '@/store/artifactStore'
import { useRunStore } from '@/store/runStore'
import { cn } from '@/lib/utils'
import type { ExecutionLog } from '@/schemas/execution'
import { createPreview } from '@/utils/textPreview'
import { RunArtifactsPanel } from '@/components/artifacts/RunArtifactsPanel'

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

interface ExecutionInspectorProps {
  onRerunRun?: (runId: string) => void
}

export function ExecutionInspector({ onRerunRun }: ExecutionInspectorProps = {}) {
  const {
    selectedRunId,
    events,
    playbackMode,
    isPlaying,
    nodeStates,
  } = useExecutionTimelineStore()
  const { id: workflowId, currentVersion: currentWorkflowVersion } = useWorkflowStore(
    (state) => state.metadata
  )
  const workflowCacheKey = workflowId ?? '__global__'
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs)
  const runs = scopedRuns ?? []
  const { logs, status, runStatus, reset, runId: liveRunId } = useWorkflowExecution()
  const { inspectorTab, setInspectorTab } = useWorkflowUiStore()
  const fetchRunArtifacts = useArtifactStore((state) => state.fetchRunArtifacts)
  const [logModal, setLogModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: '',
  })

  const selectedRun = useMemo(() => (
    runs.find(run => run.id === selectedRunId)
  ), [runs, selectedRunId])

  useEffect(() => {
    if (selectedRunId && inspectorTab === 'artifacts') {
      void fetchRunArtifacts(selectedRunId)
    }
  }, [selectedRunId, inspectorTab, fetchRunArtifacts])

  const displayLogs = events.length > 0 ? events : logs
  const retrySummary = useMemo(() => {
    const states = Object.values(nodeStates)
    if (states.length === 0) {
      return { totalRetries: 0, nodesWithRetries: 0 }
    }
    return states.reduce(
      (acc, state) => {
        if (state.retryCount > 0) {
          acc.totalRetries += state.retryCount
          acc.nodesWithRetries += 1
        }
        return acc
      },
      { totalRetries: 0, nodesWithRetries: 0 }
    )
  }, [nodeStates])

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

  const statusBadge = selectedRun ? (
    <Badge
      variant={selectedRun.status === 'RUNNING' ? 'default' : selectedRun.status === 'FAILED' ? 'destructive' : 'secondary'}
      className="text-xs"
    >
      {selectedRun.status.toUpperCase()}
    </Badge>
  ) : null
  const runVersion = typeof selectedRun?.workflowVersion === 'number' ? selectedRun.workflowVersion : null
  const versionMismatch =
    runVersion !== null &&
    typeof currentWorkflowVersion === 'number' &&
    runVersion !== currentWorkflowVersion
  const versionBadge = runVersion !== null ? (
    <Badge
      variant={versionMismatch ? 'destructive' : 'secondary'}
      className="text-[10px] uppercase tracking-wide"
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
                  onClick={() => reset()}
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

        <div className="border-b bg-background/60 px-3 py-2">
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
              variant={inspectorTab === 'artifacts' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setInspectorTab('artifacts')}
            >
              Artifacts
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {inspectorTab === 'events' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex-shrink-0 border-b bg-background/60">
                <ExecutionTimeline />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <EventInspector className="h-full" />
              </div>
            </div>
          )}

          {inspectorTab === 'logs' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-background/70 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>{displayLogs.length} log entries</span>
                  {retrySummary.totalRetries > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-700">
                      {retrySummary.totalRetries} retries across {retrySummary.nodesWithRetries} node{retrySummary.nodesWithRetries === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <span className={cn('font-medium', playbackMode === 'live' ? 'text-green-600' : 'text-blue-600')}>
                  {playbackMode === 'live' ? (isPlaying ? 'Live (following)' : 'Live paused') : 'Execution playback'}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 pb-20 space-y-2 text-xs font-mono bg-background/40">
                {displayLogs.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">
                    No logs to display for this run.
                  </div>
                ) : (
                  displayLogs.map((log) => {
                    const executionLog = log as ExecutionLog
                    const fullMessage = buildLogMessage(executionLog)
                    const preview = createPreview(fullMessage, { charLimit: 220, lineLimit: 4 })
                    const previewText = preview.truncated
                      ? `${preview.text.trimEnd()}\n…`
                      : preview.text
                    const hasAnsi = /\u001b\[[0-9;]*m/.test(previewText)
                    const au = hasAnsi ? new AnsiUp() : null
                    const ansiHtml = hasAnsi && au ? au.ansi_to_html(previewText) : ''

                    return (
                      <div key={log.id} className="border rounded-md bg-background px-3 py-2 space-y-1 min-w-0">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{formatTime(log.timestamp)}</span>
                          <Badge variant={log.level === 'error' ? 'destructive' : log.level === 'warn' ? 'warning' : 'secondary'} className="text-[10px] uppercase">
                            {log.level.toUpperCase()}
                          </Badge>
                        </div>
                        {log.nodeId && (
                          <div className="text-[11px] text-muted-foreground">Node: {log.nodeId}</div>
                        )}
                        <div className="text-[11px] max-w-full">
                          {hasAnsi ? (
                            <div
                              className="font-mono text-[11px] whitespace-pre-wrap break-words"
                              dangerouslySetInnerHTML={{ __html: ansiHtml }}
                            />
                          ) : (
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                              {previewText}
                            </pre>
                          )}
                          {preview.truncated && (
                            <button
                              className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                              onClick={() => openLogModal(fullMessage, executionLog)}
                            >
                              View full message
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {inspectorTab === 'artifacts' && (
            <RunArtifactsPanel runId={selectedRunId ?? null} />
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
