import { useState, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Terminal, X, ArrowDown, Pause, Play, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useExecutionStore } from '@/store/executionStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { RunSelector } from '@/components/timeline/RunSelector'
import { ExecutionTimeline } from '@/components/timeline/ExecutionTimeline'
import { EventInspector } from '@/components/timeline/EventInspector'

export function BottomPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'results' | 'history' | 'timeline'>('logs')
  const [autoScroll, setAutoScroll] = useState(true)
  const {
    logs: liveLogs,
    status,
    streamingMode,
    runId: liveRunId,
  } = useExecutionStore()
  const {
    selectedRunId,
    events: timelineEvents,
  } = useExecutionTimelineStore()
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  const hasSelectedRun = Boolean(selectedRunId)
  const isCurrentRunSelected = hasSelectedRun && liveRunId === selectedRunId
  const hasTimelineEvents = hasSelectedRun && timelineEvents.length > 0
  const useTimelineLogs = hasSelectedRun && (!isCurrentRunSelected || hasTimelineEvents)
  const displayLogs = useTimelineLogs ? timelineEvents : liveLogs

  // Auto-scroll to bottom when new logs arrive (if enabled)
  useEffect(() => {
    if (isExpanded && activeTab === 'logs' && autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [displayLogs, isExpanded, activeTab, autoScroll])

  // Disable auto-scroll when user manually scrolls up
  const handleScroll = () => {
    if (!logsContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 10 // 10px tolerance

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false)
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true)
    }
  }

  // Auto-expand when execution starts
  useEffect(() => {
    if (status === 'running' && !isExpanded) {
      setIsExpanded(true)
    }
  }, [status, isExpanded])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'info':
        return 'text-blue-500'
      case 'warn':
        return 'text-yellow-500'
      case 'error':
        return 'text-red-500'
      case 'debug':
        return 'text-gray-500'
      default:
        return 'text-gray-500'
    }
  }

  const getLevelBadgeVariant = (level: string) => {
    switch (level) {
      case 'error':
        return 'destructive' as const
      case 'warn':
        return 'warning' as const
      default:
        return 'secondary' as const
    }
  }

  const clearLogs = () => {
    if (useTimelineLogs) {
      return
    }
    useExecutionStore.setState({ logs: [] })
  }

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setAutoScroll(true)
  }

  const getStreamingModeBadge = () => {
    switch (streamingMode) {
      case 'realtime':
        return { text: 'LIVE', variant: 'default' as const, color: 'text-green-500' }
      case 'polling':
        return { text: 'POLLING', variant: 'secondary' as const, color: 'text-yellow-500' }
      case 'connecting':
        return { text: 'CONNECTING', variant: 'secondary' as const, color: 'text-blue-500' }
      default:
        return { text: 'OFFLINE', variant: 'secondary' as const, color: 'text-gray-500' }
    }
  }

  return (
    <div
      className={`border-t bg-background transition-all duration-300 ${
        isExpanded ? 'h-[400px]' : 'h-[40px]'
      }`}
    >
      <div className="h-[40px] flex items-center px-4 border-b">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('logs')}
              className={`text-sm font-medium ${
                activeTab === 'logs' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Logs
              {displayLogs.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({displayLogs.length})
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`text-sm font-medium ${
                activeTab === 'timeline' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Clock className="inline h-3 w-3 mr-1" />
              Timeline
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`text-sm font-medium ${
                activeTab === 'results' ? 'text-foreground' : 'text-muted-foreground'
              }`}
              disabled
            >
              Results
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`text-sm font-medium ${
                activeTab === 'history' ? 'text-foreground' : 'text-muted-foreground'
              }`}
              disabled
            >
              History
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Streaming mode indicator */}
          {status === 'running' && (
            <Badge variant={getStreamingModeBadge().variant} className="text-xs px-1.5">
              <span className={getStreamingModeBadge().color}>
                {getStreamingModeBadge().text}
              </span>
            </Badge>
          )}

          {/* Log scroll controls */}
          {isExpanded && activeTab === 'logs' && displayLogs.length > 0 && (
            <>
              {!autoScroll && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={scrollToBottom}
                  title="Follow live logs"
                >
                  <ArrowDown className="h-3 w-3 mr-1" />
                  Follow
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setAutoScroll(!autoScroll)}
                title={autoScroll ? "Pause autoscroll" : "Resume autoscroll"}
              >
                {autoScroll ? (
                  <Pause className="h-3 w-3 mr-1" />
                ) : (
                  <Play className="h-3 w-3 mr-1" />
                )}
                {autoScroll ? 'Pause' : 'Resume'}
              </Button>
            </>
          )}

          {displayLogs.length > 0 && !useTimelineLogs && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={clearLogs}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="h-[360px]">
          {activeTab === 'logs' && (
            <div
              ref={logsContainerRef}
              className="h-full overflow-y-auto p-4"
              onScroll={handleScroll}
            >
              <div className="space-y-2 font-mono text-sm">
                {displayLogs.length === 0 ? (
                  <div className="text-muted-foreground text-center py-8">
                    {hasSelectedRun
                      ? 'No logs recorded for this run.'
                      : 'No logs yet. Run a workflow or select a past run to view execution logs.'}
                  </div>
                ) : (
                  <>
                    {displayLogs.map((log) => (
                      <div key={log.id} className="flex items-start gap-3">
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatTime(log.timestamp)}
                        </span>
                        <Badge
                          variant={getLevelBadgeVariant(log.level)}
                          className="text-xs px-1.5 py-0 whitespace-nowrap"
                        >
                          {log.level.toUpperCase()}
                        </Badge>
                        {log.nodeId && (
                          <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                            [{log.nodeId}]
                          </span>
                        )}
                        <span className={getLevelColor(log.level)}>
                          {log.message ?? log.error?.message ?? log.type}
                        </span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="h-full flex flex-col">
              <div className="flex-shrink-0 border-b p-3">
                <RunSelector />
              </div>
              <div className="flex-shrink-0">
                <ExecutionTimeline />
              </div>
              <div className="flex-1 min-h-0">
                <EventInspector />
              </div>
            </div>
          )}

          {activeTab === 'results' && (
            <div className="h-full overflow-y-auto p-4 text-muted-foreground">
              Results will appear here
            </div>
          )}

          {activeTab === 'history' && (
            <div className="h-full overflow-y-auto p-4 text-muted-foreground">
              Execution history will appear here
            </div>
          )}
        </div>
      )}
    </div>
  )
}
