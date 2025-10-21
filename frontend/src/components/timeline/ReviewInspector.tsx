import { useMemo } from 'react'
import { RunSelector } from '@/components/timeline/RunSelector'
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline'
import { EventInspector } from '@/components/timeline/EventInspector'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { cn } from '@/lib/utils'

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

export function ReviewInspector() {
  const {
    selectedRunId,
    availableRuns,
    events,
    playbackMode,
    isPlaying,
    nodeStates,
  } = useExecutionTimelineStore()
  const { logs } = useExecutionStore()
  const { inspectorTab, setInspectorTab } = useWorkflowUiStore()

  const selectedRun = useMemo(() => (
    availableRuns.find(run => run.id === selectedRunId)
  ), [availableRuns, selectedRunId])

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

  const statusBadge = selectedRun ? (
    <Badge
      variant={selectedRun.status === 'running' ? 'default' : selectedRun.status === 'failed' ? 'destructive' : 'secondary'}
      className="text-xs"
    >
      {selectedRun.status.toUpperCase()}
    </Badge>
  ) : null

  return (
    <aside className="flex h-full min-h-0 w-full min-w-[320px] flex-col overflow-hidden border-l bg-muted/30 backdrop-blur">
      <div className="border-b p-3 space-y-3 bg-background/70">
        <div className="flex items-center justify-between">
          <RunSelector />
        </div>
        {selectedRun && (
          <div className="rounded-md border bg-background px-3 py-2 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm truncate">{selectedRun.workflowName}</span>
              {statusBadge}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>Run #{selectedRun.id.slice(-6)}</span>
              {selectedRun.duration && <span>{Math.round(selectedRun.duration / 1000)}s</span>}
              <span>{selectedRun.eventCount} events</span>
              {selectedRun.nodeCount > 0 && <span>{selectedRun.nodeCount} nodes</span>}
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
            variant={inspectorTab === 'data' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-3"
            onClick={() => setInspectorTab('data')}
            disabled
            title="Data flows coming soon"
          >
            Data
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
                {playbackMode === 'live' ? (isPlaying ? 'Live (following)' : 'Live paused') : 'Review playback'}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 pb-20 space-y-2 text-xs font-mono bg-background/40">
              {displayLogs.length === 0 ? (
                <div className="text-muted-foreground text-center py-8">
                  No logs to display for this run.
                </div>
              ) : (
                displayLogs.map((log) => (
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
                    <div className="text-[11px] overflow-hidden max-w-full">
                      <div className="truncate">
                        {log.message ?? log.error?.message ?? log.type}
                      </div>
                      {(log.message ?? log.error?.message ?? log.type)?.length > 100 && (
                        <button 
                          className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                          onClick={() => {
                            // Create a modal to show the full text
                            const modal = document.createElement('div');
                            modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                            modal.innerHTML = `
                              <div class="bg-white rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-auto">
                                <div class="flex justify-between items-center mb-4">
                                  <h3 class="text-lg font-semibold">Full Log Message</h3>
                                  <button class="text-gray-500 hover:text-gray-700" onclick="this.closest('.fixed').remove()">×</button>
                                </div>
                                <pre class="text-xs font-mono whitespace-pre-wrap break-words">${log.message ?? log.error?.message ?? log.type}</pre>
                              </div>
                            `;
                            document.body.appendChild(modal);
                            modal.addEventListener('click', (e) => {
                              if (e.target === modal) modal.remove();
                            });
                          }}
                        >
                          View full message
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {inspectorTab === 'data' && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground px-6 text-center">
            Data flow visualization is on the roadmap—stay tuned.
          </div>
        )}
      </div>
    </aside>
  )
}
