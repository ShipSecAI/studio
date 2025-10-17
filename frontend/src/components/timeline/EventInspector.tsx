import { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronDown, Clock, FileText, AlertCircle, CheckCircle, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useExecutionTimelineStore, type TimelineEvent } from '@/store/executionTimelineStore'
import { cn } from '@/lib/utils'

const EVENT_ICONS = {
  STARTED: CheckCircle,
  COMPLETED: CheckCircle,
  FAILED: AlertCircle,
  RUNNING: Activity,
  WAITING: Clock,
}

const LEVEL_BADGE: Record<string, 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
  debug: 'outline',
}

interface EventInspectorProps {
  className?: string
}

export function EventInspector({ className }: EventInspectorProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const autoSelectionSignatureRef = useRef<string | null>(null)

  const {
    selectedRunId,
    events,
    currentTime,
    nodeStates,
    dataFlows,
    selectedNodeId,
    selectedEventId,
    selectEvent,
    selectNode,
    seek
  } = useExecutionTimelineStore()

  const filteredEvents = useMemo(() => {
    if (!selectedNodeId) {
      return []
    }
    return events.filter(event => event.nodeId === selectedNodeId)
  }, [events, selectedNodeId])

  const displayEvents = filteredEvents.length > 0 ? filteredEvents : events

  const displaySignature = useMemo(() => {
    if (displayEvents.length === 0) {
      return `${selectedRunId ?? 'none'}|${selectedNodeId ?? 'all'}|empty`
    }
    const firstId = displayEvents[0].id
    const lastId = displayEvents[displayEvents.length - 1].id
    return `${selectedRunId ?? 'none'}|${selectedNodeId ?? 'all'}|${firstId}-${lastId}`
  }, [displayEvents, selectedRunId, selectedNodeId])

  useEffect(() => {
    if (displayEvents.length === 0) {
      if (selectedEventId !== null) {
        selectEvent(null)
      }
      autoSelectionSignatureRef.current = displaySignature
      return
    }

    const hasSelection = selectedEventId && displayEvents.some(event => event.id === selectedEventId)
    if (!hasSelection) {
      if (selectedEventId === null && autoSelectionSignatureRef.current === displaySignature) {
        return
      }

      const closestEvent = displayEvents.reduce<{ event: TimelineEvent; diff: number } | null>((closest, event) => {
        const diff = Math.abs(event.offsetMs - currentTime)
        if (!closest || diff < closest.diff) {
          return { event, diff }
        }
        return closest
      }, null)

      const fallbackEvent = displayEvents[displayEvents.length - 1]
      selectEvent((closestEvent?.event ?? fallbackEvent).id)
      autoSelectionSignatureRef.current = displaySignature
      return
    }

    autoSelectionSignatureRef.current = displaySignature
  }, [displayEvents, selectedEventId, currentTime, selectEvent, displaySignature])

  useEffect(() => {
    if (selectedEventId) {
      setExpandedEvents(prev => {
        if (prev.has(selectedEventId)) return prev
        const next = new Set(prev)
        next.add(selectedEventId)
        return next
      })
    }
  }, [selectedEventId])

  const handleEventToggle = (event: TimelineEvent) => {
    if (event.nodeId) {
      selectNode(event.nodeId)
    }
    selectEvent(event.id)
    seek(event.offsetMs)

    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(event.id)) {
        next.delete(event.id)
      } else {
        next.add(event.id)
      }
      return next
    })
  }

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  const formatDuration = (start: string, end?: string): string => {
    const startTime = new Date(start).getTime()
    const endTime = end ? new Date(end).getTime() : Date.now()
    const duration = endTime - startTime
    return `${duration}ms`
  }

  const formatData = (data: Record<string, unknown>) => {
    try {
      return JSON.stringify(data, null, 2)
    } catch (error) {
      return 'Unable to render data payload'
    }
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Event Inspector</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedRunId ? (
            selectedNodeId
              ? filteredEvents.length > 0
                ? `${filteredEvents.length} events for ${selectedNodeId}`
                : `No events for ${selectedNodeId} — showing all`
              : `${displayEvents.length} events across all nodes`
          ) : (
            'Select a run to explore execution events.'
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayEvents.length === 0 ? (
          <div className="px-4 py-8 text-xs text-muted-foreground">
            No events available.
          </div>
        ) : (
          <ul className="divide-y">
            {displayEvents.map(event => {
              const IconComponent = EVENT_ICONS[event.type] || FileText
              const isExpanded = expandedEvents.has(event.id)
              const isSelected = event.id === selectedEventId
              const isCurrent = Math.abs(event.offsetMs - currentTime) < 100
              const nodeState = event.nodeId ? nodeStates[event.nodeId] : undefined

              return (
                <li key={event.id} className={cn('px-4 py-3 transition-colors',
                  isSelected ? 'bg-muted/70' : 'hover:bg-muted/40',
                  isCurrent && 'ring-1 ring-blue-400/60')}
                >
                  <button
                    type="button"
                    onClick={() => handleEventToggle(event)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <div className="flex flex-1 items-start gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full border bg-background">
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {event.type}
                          </span>
                          <Badge variant={LEVEL_BADGE[event.level] ?? 'outline'} className="text-[10px] uppercase">
                            {event.level}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{formatTimestamp(event.timestamp)}</span>
                          {event.nodeId && (
                            <span className="truncate">Node {event.nodeId}</span>
                          )}
                        </div>
                        {event.message && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {event.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronDown className={cn('mt-1 h-4 w-4 flex-shrink-0 transition-transform', isExpanded && 'rotate-180')} />
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 rounded-md border bg-background/80 p-3 text-xs">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="font-medium">Event ID</span>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                            {event.id}
                          </div>
                        </div>
                        <div>
                          <span className="font-medium">Timestamp</span>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {event.timestamp}
                          </div>
                        </div>
                        <div>
                          <span className="font-medium">Node</span>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {event.nodeId ?? 'System'}
                          </div>
                        </div>
                        <div>
                          <span className="font-medium">Since start</span>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {formatDuration(displayEvents[0].timestamp, event.timestamp)}
                          </div>
                        </div>
                      </div>

                      {event.message && (
                        <div>
                          <span className="font-medium">Message</span>
                          <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                            {event.message}
                          </div>
                        </div>
                      )}

                      {event.data && Object.keys(event.data).length > 0 && (
                        <div>
                          <span className="font-medium">Data</span>
                          <pre className="mt-1 max-h-40 overflow-auto rounded border bg-muted/30 px-3 py-2 font-mono text-[11px]">
                            {formatData(event.data)}
                          </pre>
                        </div>
                      )}

                      {nodeState && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="font-medium">Node status</span>
                            <div className="mt-1 text-muted-foreground">
                              {nodeState.status}
                            </div>
                          </div>
                          <div>
                            <span className="font-medium">Progress</span>
                            <div className="mt-1 text-muted-foreground">
                              {Math.round(nodeState.progress)}%
                            </div>
                          </div>
                          <div>
                            <span className="font-medium">Events seen</span>
                            <div className="mt-1 text-muted-foreground">
                              {nodeState.eventCount}
                            </div>
                          </div>
                          {nodeState.startTime && (
                            <div>
                              <span className="font-medium">Started</span>
                              <div className="mt-1 text-muted-foreground">
                                {formatTimestamp(new Date(nodeState.startTime).toISOString())}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {event.nodeId && (
                        <div>
                          <span className="font-medium">Related data flows</span>
                          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                            {dataFlows
                              .filter(flow => flow.sourceNode === event.nodeId || flow.targetNode === event.nodeId)
                              .slice(0, 5)
                              .map((flow, index) => (
                                <div key={index} className="rounded border bg-muted/20 px-2 py-1">
                                  <div>{flow.sourceNode} → {flow.targetNode}</div>
                                  <div className="opacity-70">{flow.type} • {(flow.size / 1024).toFixed(1)}KB</div>
                                </div>
                              ))}
                            {dataFlows.filter(flow => flow.sourceNode === event.nodeId || flow.targetNode === event.nodeId).length === 0 && (
                              <div className="opacity-70">No data packets for this event.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
