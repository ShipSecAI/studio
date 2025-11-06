import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronDown, FileText, AlertCircle, CheckCircle, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MessageModal } from '@/components/ui/MessageModal'
import { createPreview } from '@/utils/textPreview'
import { useExecutionTimelineStore, type TimelineEvent } from '@/store/executionTimelineStore'
import { cn } from '@/lib/utils'

const EVENT_ICONS: Partial<Record<TimelineEvent['type'], typeof FileText>> = {
  STARTED: CheckCircle,
  COMPLETED: CheckCircle,
  FAILED: AlertCircle,
  PROGRESS: Activity,
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
  const [fullMessageModal, setFullMessageModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: ''
  })
  const autoSelectionSignatureRef = useRef<string | null>(null)
  const eventsListRef = useRef<HTMLUListElement>(null)
  const autoScrollRef = useRef<boolean>(true)

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
    seek,
    playbackMode,
    isPlaying
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

  // Auto-scroll to latest event in live mode
  useEffect(() => {
    if (playbackMode === 'live' && eventsListRef.current && displayEvents.length > 0 && autoScrollRef.current) {
      // Scroll to the bottom smoothly
      eventsListRef.current.scrollTop = eventsListRef.current.scrollHeight
    }
  }, [displayEvents.length, playbackMode, events])

  // Auto-scroll to current event during replay
  useEffect(() => {
    if (playbackMode === 'replay' && eventsListRef.current && displayEvents.length > 0 && autoScrollRef.current) {
      // Find the event closest to current time
      const currentEvent = displayEvents.find(event =>
        Math.abs(event.offsetMs - currentTime) < 300 // Match the EventInspector tolerance
      )

      if (currentEvent) {
        // Find the element for this event
        const eventElement = eventsListRef.current.querySelector(`[data-event-id="${currentEvent.id}"]`)
        if (eventElement) {
          eventElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [currentTime, playbackMode, displayEvents, selectedEventId])

  // Re-enable auto-scroll when playback starts or when seeking to a new position
  useEffect(() => {
    if (isPlaying && playbackMode === 'replay') {
      autoScrollRef.current = true
    }
  }, [isPlaying, playbackMode])

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

  const handleScroll = () => {
    if (eventsListRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = eventsListRef.current
      // If user has scrolled up from bottom, disable auto-scroll
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10 // 10px tolerance
      autoScrollRef.current = isAtBottom
    }
  }

  const handleEventToggle = (event: TimelineEvent) => {
    if (event.nodeId) {
      selectNode(event.nodeId)
    }
    selectEvent(event.id)
    seek(event.offsetMs)

    // Disable auto-scroll when user manually selects an event
    autoScrollRef.current = false

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

  const openFullMessageModal = (message: string, event: TimelineEvent) => {
    setFullMessageModal({
      open: true,
      message,
      title: `Full Message - ${event.type} - ${event.nodeId || 'System'}`
    })
  }

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp)
    const base = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`
  }

  const formatDuration = (start: string, end?: string): string => {
    const startTime = new Date(start).getTime()
    const endTime = end ? new Date(end).getTime() : Date.now()
    const duration = Math.max(0, endTime - startTime)
    
    if (duration < 1000) {
      return `${duration}ms`
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(2)}s`
    } else {
      const minutes = Math.floor(duration / 60000)
      const seconds = ((duration % 60000) / 1000).toFixed(1)
      return `${minutes}m ${seconds}s`
    }
  }

  const formatData = (data: Record<string, unknown>) => {
    try {
      return JSON.stringify(data, null, 2)
    } catch (error) {
      return 'Unable to render data payload'
    }
  }

  return (
    <React.Fragment>
      <div className={cn('flex h-full min-h-0 flex-col', className)}>
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Event Inspector</h3>
            <div className="flex items-center gap-2 text-xs">
              {playbackMode === 'live' && (
                <>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  <span className="font-medium text-red-600">LIVE</span>
                  {autoScrollRef.current && (
                    <span className="text-muted-foreground">• Auto-scrolling</span>
                  )}
                </>
              )}
              {playbackMode === 'replay' && autoScrollRef.current && (
                <>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  <span className="font-medium text-blue-600">FOLLOWING</span>
                </>
              )}
            </div>
          </div>
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

        <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40"
             onScroll={handleScroll}>
          {displayEvents.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground">
              No events available.
            </div>
          ) : (
            <ul ref={eventsListRef} className="divide-y">
              {displayEvents.map((event, index) => {
                const IconComponent = EVENT_ICONS[event.type] || FileText
                const isExpanded = expandedEvents.has(event.id)
                const isSelected = event.id === selectedEventId
                const isCurrent = Math.abs(event.offsetMs - currentTime) < 500 // More generous tolerance for better highlighting
                const isLatestEvent = index === displayEvents.length - 1
                const isRecentLiveEvent = playbackMode === 'live' && isLatestEvent
                const isCurrentReplayEvent = playbackMode === 'replay' && isCurrent
                const nodeState = event.nodeId ? nodeStates[event.nodeId] : undefined
                const messagePreview = event.message ? createPreview(event.message, { charLimit: 220, lineLimit: 6 }) : null
                const messagePreviewText = messagePreview
                  ? (messagePreview.truncated ? `${messagePreview.text.trimEnd()}\n…` : messagePreview.text)
                  : ''

                return (
                  <li key={event.id}
                    data-event-id={event.id}
                    className={cn('px-4 py-3 transition-colors relative',
                    isSelected ? 'bg-muted/70' : 'hover:bg-muted/40',
                    isCurrentReplayEvent && 'ring-2 ring-blue-500 bg-blue-50/70 dark:bg-blue-950/40',
                    isRecentLiveEvent && 'bg-blue-50/50 border-l-2 border-l-blue-500 dark:bg-blue-950/30')}
                  >
                    <button
                      type="button"
                      onClick={() => handleEventToggle(event)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <div className="flex flex-1 items-start gap-3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div className={cn('flex h-7 w-7 items-center justify-center rounded-full border bg-background relative',
                          isRecentLiveEvent && 'bg-blue-100 dark:bg-blue-900',
                          isCurrentReplayEvent && 'bg-blue-200 dark:bg-blue-800 ring-2 ring-blue-500')}>
                          <IconComponent className="h-4 w-4" />
                          {isRecentLiveEvent && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                          )}
                          {isCurrentReplayEvent && (
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1 overflow-hidden" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {event.type}
                            </span>
                            <Badge variant={LEVEL_BADGE[event.level] ?? 'outline'} className="text-[10px] uppercase">
                              {event.level}
                            </Badge>
                            {typeof event.metadata?.attempt === 'number' && (
                              <Badge
                                variant={event.metadata.attempt > 1 ? 'warning' : 'outline'}
                                className="text-[10px] uppercase"
                              >
                                Attempt {event.metadata.attempt}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatTimestamp(event.timestamp)}</span>
                            {event.nodeId && (
                              <span className="truncate">Node {event.nodeId}</span>
                            )}
                            {event.metadata?.activityId && (
                              <span className="truncate font-mono text-[10px]">
                                {event.metadata.activityId}
                              </span>
                            )}
                          </div>
                          {event.message && (
                            <p
                              className="text-xs text-muted-foreground"
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%'
                              }}
                            >
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
                              <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
                                {messagePreviewText}
                              </pre>
                              {messagePreview?.truncated && (
                                <button
                                  className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                                  onClick={() => openFullMessageModal(event.message!, event)}
                                >
                                  View full message
                                </button>
                              )}
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

                        {event.metadata && (
                          <div>
                            <span className="font-medium">Execution metadata</span>
                            <div className="mt-1 grid grid-cols-2 gap-3 text-muted-foreground">
                              {event.metadata.activityId && (
                                <div>
                                  <span className="block text-[10px] uppercase">Activity ID</span>
                                  <span className="font-mono text-[11px] break-all">{event.metadata.activityId}</span>
                                  <span className="font-mono text-[11px]">{event.metadata.activityId}</span>
                                </div>
                              )}
                              {typeof event.metadata.attempt === 'number' && (
                                <div>
                                  <span className="block text-[10px] uppercase">Attempt</span>
                                  <span className="font-mono text-[11px]">{event.metadata.attempt}</span>
                                </div>
                              )}
                              {event.metadata.correlationId && (
                                <div className="col-span-2">
                                  <span className="block text-[10px] uppercase">Correlation</span>
                                  <span className="font-mono text-[11px] break-all">{event.metadata.correlationId}</span>
                                </div>
                              )}
                              {event.metadata.streamId && (
                                <div>
                                  <span className="block text-[10px] uppercase">Stream</span>
                                  <span className="font-mono text-[11px]">{event.metadata.streamId}</span>
                                </div>
                              )}
                              {event.metadata.joinStrategy && (
                                <div>
                                  <span className="block text-[10px] uppercase">Join</span>
                                  <span className="font-mono text-[11px]">{event.metadata.joinStrategy}</span>
                                </div>
                              )}
                              {event.metadata.triggeredBy && (
                                <div className="col-span-2">
                                  <span className="block text-[10px] uppercase">Triggered by</span>
                                  <span className="font-mono text-[11px] break-all">{event.metadata.triggeredBy}</span>
                                </div>
                              )}
                              {event.metadata.retryPolicy && (
                                <div className="col-span-2">
                                  <span className="block text-[10px] uppercase">Retry policy</span>
                                  <div className="mt-1 rounded border bg-muted/30 px-3 py-2 font-mono text-[10px] space-y-1">
                                    {event.metadata.retryPolicy.maxAttempts !== undefined && (
                                      <div>maxAttempts: {event.metadata.retryPolicy.maxAttempts}</div>
                                    )}
                                    {event.metadata.retryPolicy.initialIntervalSeconds !== undefined && (
                                      <div>initialIntervalSeconds: {event.metadata.retryPolicy.initialIntervalSeconds}s</div>
                                    )}
                                    {event.metadata.retryPolicy.maximumIntervalSeconds !== undefined && (
                                      <div>maximumIntervalSeconds: {event.metadata.retryPolicy.maximumIntervalSeconds}s</div>
                                    )}
                                    {event.metadata.retryPolicy.backoffCoefficient !== undefined && (
                                      <div>backoffCoefficient: {event.metadata.retryPolicy.backoffCoefficient}</div>
                                    )}
                                    {event.metadata.retryPolicy.nonRetryableErrorTypes && event.metadata.retryPolicy.nonRetryableErrorTypes.length > 0 && (
                                      <div>nonRetryableErrorTypes: {event.metadata.retryPolicy.nonRetryableErrorTypes.join(', ')}</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            {event.metadata.failure && (
                              <div className="col-span-2">
                                <span className="block text-[10px] uppercase">Failure context</span>
                                <div className="mt-1 rounded border bg-destructive/10 px-3 py-2 text-destructive text-[11px] space-y-1">
                                  <div>at: {event.metadata.failure.at}</div>
                                  <div>message: {event.metadata.failure.reason.message}</div>
                                  {event.metadata.failure.reason.name && (
                                    <div>name: {event.metadata.failure.reason.name}</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
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
                          {nodeState.retryCount > 0 && (
                            <div>
                              <span className="font-medium">Retries</span>
                              <div className="mt-1 text-muted-foreground">
                                {nodeState.retryCount}
                              </div>
                            </div>
                          )}
                          {nodeState.startTime && (
                            <div>
                              <span className="font-medium">Started</span>
                              <div className="mt-1 text-muted-foreground">
                                {formatTimestamp(new Date(nodeState.startTime).toISOString())}
                              </div>
                            </div>
                          )}
                          {nodeState.lastActivityId && (
                            <div className="col-span-2">
                              <span className="font-medium">Latest activity</span>
                              <div className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                                {nodeState.lastActivityId}
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

      <MessageModal
        open={fullMessageModal.open}
        onOpenChange={(open) => setFullMessageModal(prev => ({ ...prev, open }))}
        title={fullMessageModal.title}
        message={fullMessageModal.message}
      />
    </React.Fragment>
  )
}
