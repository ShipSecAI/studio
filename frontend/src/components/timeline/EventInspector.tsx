import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ChevronDown, FileText, AlertCircle, CheckCircle, Activity, X, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MessageModal } from '@/components/ui/MessageModal'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createPreview } from '@/utils/textPreview'
import { useExecutionTimelineStore, type TimelineEvent } from '@/store/executionTimelineStore'
import { cn } from '@/lib/utils'

const EVENT_ICONS: Partial<Record<TimelineEvent['type'], typeof FileText>> = {
  STARTED: CheckCircle,
  COMPLETED: CheckCircle,
  FAILED: AlertCircle,
  PROGRESS: Activity,
}

const EVENT_ICON_TONE: Record<TimelineEvent['type'], string> = {
  STARTED: 'text-violet-600 border-violet-200 bg-violet-50 dark:text-violet-200 dark:border-violet-500/40 dark:bg-violet-500/10',
  PROGRESS: 'text-sky-600 border-sky-200 bg-sky-50 dark:text-sky-200 dark:border-sky-500/40 dark:bg-sky-500/10',
  COMPLETED: 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-200 dark:border-emerald-500/40 dark:bg-emerald-500/10',
  FAILED: 'text-rose-600 border-rose-200 bg-rose-50 dark:text-rose-200 dark:border-rose-500/40 dark:bg-rose-500/10',
}

const LEVEL_BADGE: Record<string, 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
  debug: 'outline',
}

export type EventLayoutVariant = 'stacked-soft' | 'stacked-contrast' | 'stacked-rail'

interface EventInspectorProps {
  className?: string
  layoutVariant?: EventLayoutVariant
}

const INSIGNIFICANT_PAYLOAD_KEYS = new Set(['stream', 'origin'])

const EVENT_LAYOUT_PRESETS: Record<EventLayoutVariant, {
  li: string
  button: string
  iconWrap: string
  title: string
  meta: string
  message: string
}> = {
  'stacked-soft': {
    li: 'px-3 py-2 transition-colors',
    button: 'rounded-md',
    iconWrap: 'h-7 w-7 border',
    title: 'text-sm font-semibold',
    meta: 'text-xs text-muted-foreground',
    message: 'text-xs text-muted-foreground/90',
  },
  'stacked-contrast': {
    li: 'px-3 py-3 transition-colors bg-white/80 dark:bg-neutral-900/60 backdrop-blur',
    button: 'rounded-md',
    iconWrap: 'h-8 w-8 border-2',
    title: 'text-sm font-semibold tracking-wide',
    meta: 'text-[11px] text-muted-foreground',
    message: 'text-[11px] text-muted-foreground',
  },
  'stacked-rail': {
    li: 'px-3 py-3 transition-colors border-l-2',
    button: 'rounded-none',
    iconWrap: 'h-6 w-6 border',
    title: 'text-[13px] font-semibold uppercase',
    meta: 'text-[11px] text-muted-foreground',
    message: 'text-[11px] text-muted-foreground/90',
  },
}

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

const normalizeEventPayload = (data: unknown): Record<string, unknown> | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(([key, value]) => {
    if (INSIGNIFICANT_PAYLOAD_KEYS.has(key)) return false
    return hasMeaningfulValue(value)
  })
  if (entries.length === 0) {
    return undefined
  }
  return Object.fromEntries(entries)
}

export function EventInspector({ className, layoutVariant = 'stacked-soft' }: EventInspectorProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const [fullMessageModal, setFullMessageModal] = useState<{ open: boolean; message: string; title: string }>({
    open: false,
    message: '',
    title: ''
  })
  const [diagnosticsDialogOpen, setDiagnosticsDialogOpen] = useState<string | null>(null)
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

  const handleEventToggle = (event: TimelineEvent, hasExpandableContent: boolean) => {
    if (!hasExpandableContent) return
    
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
          {selectedNodeId && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Node filter</span>
              <button
                type="button"
                onClick={() => selectNode(null)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground transition hover:bg-muted"
                aria-label="Clear node filter"
              >
                {selectedNodeId}
                <X className="h-3 w-3 opacity-70" />
              </button>
            </div>
          )}
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40"
          onScroll={handleScroll}
        >
          {displayEvents.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground">
              No events available.
            </div>
          ) : (
            <ul ref={eventsListRef} className="divide-y divide-border">
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
                const trimmedMessage = typeof event.message === 'string' ? event.message.trim() : ''
                const expandedMessage = trimmedMessage || messagePreviewText
                const shouldShowFullMessageButton = Boolean(
                  trimmedMessage && (messagePreview?.truncated || trimmedMessage.length > 320)
                )
                const relatedFlows = event.nodeId
                  ? dataFlows.filter(flow => flow.sourceNode === event.nodeId || flow.targetNode === event.nodeId)
                  : []
                const normalizedPayload = normalizeEventPayload(event.data)
                const hasExpandableContent = Boolean(normalizedPayload || messagePreview?.truncated)
                const preset = EVENT_LAYOUT_PRESETS[layoutVariant]
                return (
                  <li key={event.id}
                    data-event-id={event.id}
                    className={cn(
                      'transition-colors relative',
                      preset.li,
                      layoutVariant === 'stacked-rail' && event.type === 'FAILED' && 'border-l-rose-400/80',
                      layoutVariant === 'stacked-rail' && event.type === 'COMPLETED' && 'border-l-emerald-400/80',
                      layoutVariant === 'stacked-rail' && event.type === 'PROGRESS' && 'border-l-sky-400/80',
                      layoutVariant === 'stacked-rail' && event.type === 'STARTED' && 'border-l-violet-300/80',
                      isSelected ? 'bg-muted/60' : 'hover:bg-muted/50',
                      isCurrentReplayEvent && 'bg-blue-50/80 dark:bg-blue-950/40',
                      isRecentLiveEvent && 'animate-pulse bg-slate-50 dark:bg-slate-900/40'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleEventToggle(event, hasExpandableContent)}
                      className={cn(
                        'relative flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition',
                        preset.button,
                        !hasExpandableContent && 'cursor-default'
                      )}
                    >
                      <div className="flex flex-1 items-start gap-3 relative z-10">
                        <div
                          className={cn(
                            'flex items-center justify-center rounded-full border bg-background relative shrink-0 transition-colors',
                            preset.iconWrap,
                            EVENT_ICON_TONE[event.type] ?? 'text-slate-600 border-border'
                          )}
                        >
                          <IconComponent className="h-4 w-4" />
                        </div>
                        <div className="flex-1 space-y-1 overflow-hidden">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(preset.title)}>{event.type}</span>
                            <Badge variant={LEVEL_BADGE[event.level] ?? 'secondary'} className="text-[10px] font-medium text-muted-foreground bg-muted/40">
                              {event.level ?? 'info'}
                            </Badge>
                            {typeof event.metadata?.attempt === 'number' && (
                              <span className="rounded-full bg-muted px-2 py-[2px] text-[10px] text-muted-foreground">
                                Attempt {event.metadata.attempt}
                              </span>
                            )}
                          </div>
                          <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', preset.meta)}>
                            <span className="font-mono text-[11px]">{formatTimestamp(event.timestamp)}</span>
                            {event.nodeId && <span className="truncate text-muted-foreground">Node {event.nodeId}</span>}
                            {event.metadata?.activityId && (
                              <span className="truncate font-mono text-[10px] text-muted-foreground/80">
                                {event.metadata.activityId}
                              </span>
                            )}
                          </div>
                          {(messagePreviewText || expandedMessage) && (
                            <p
                              className={cn(
                                'break-words text-[13px] text-muted-foreground/80 leading-snug',
                                preset.message,
                                isExpanded
                                  ? 'line-clamp-none whitespace-pre-wrap max-h-36 overflow-auto pr-1'
                                  : 'line-clamp-2'
                              )}
                            >
                              {isExpanded ? expandedMessage : messagePreviewText}
                            </p>
                          )}
                          {isExpanded && shouldShowFullMessageButton && (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-primary hover:text-primary/80"
                              onClick={() => openFullMessageModal(event.message!, event)}
                            >
                              Read full log
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDiagnosticsDialogOpen(event.id)
                                }}
                                className="flex items-center justify-center rounded-md border border-border/60 bg-muted/20 p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                aria-label="View diagnostics"
                              >
                                <Wrench className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Diagnostics</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      {hasExpandableContent && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEventToggle(event, hasExpandableContent)
                          }}
                          className="absolute bottom-2 right-2 z-20 flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <ChevronDown
                            className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                          />
                        </button>
                      )}
                    </button>

                    {isExpanded && normalizedPayload && (
                      <div className="mt-3 space-y-4 rounded-md border bg-background/80 p-3 text-xs">
                        <section>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Payload
                          </div>
                          <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-muted/20 px-3 py-2 font-mono text-[11px]">
                            {formatData(normalizedPayload)}
                          </pre>
                        </section>
                      </div>
                    )}

                    <Dialog open={diagnosticsDialogOpen === event.id} onOpenChange={(open) => setDiagnosticsDialogOpen(open ? event.id : null)}>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Diagnostics - {event.type}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-3 text-[11px] text-muted-foreground">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <span className="block text-[10px] uppercase tracking-wide">Event ID</span>
                              <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                                {event.id}
                              </div>
                            </div>
                            <div>
                              <span className="block text-[10px] uppercase tracking-wide">Elapsed</span>
                              <div className="mt-1 font-mono text-[11px] text-foreground">
                                {formatDuration(displayEvents[0].timestamp, event.timestamp)}
                              </div>
                            </div>
                            {event.metadata?.correlationId && (
                              <div className="col-span-2">
                                <span className="block text-[10px] uppercase tracking-wide">Correlation</span>
                                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                                  {event.metadata.correlationId}
                                </div>
                              </div>
                            )}
                            {event.metadata?.streamId && (
                              <div>
                                <span className="block text-[10px] uppercase tracking-wide">Stream</span>
                                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                                  {event.metadata.streamId}
                                </div>
                              </div>
                            )}
                            {event.metadata?.triggeredBy && (
                              <div className="col-span-2">
                                <span className="block text-[10px] uppercase tracking-wide">Triggered by</span>
                                <div className="mt-1 font-mono text-[11px] text-foreground break-all">
                                  {event.metadata.triggeredBy}
                                </div>
                              </div>
                            )}
                            {event.metadata?.retryPolicy && (
                              <div className="col-span-2">
                                <span className="block text-[10px] uppercase tracking-wide">Retry policy</span>
                                <div className="mt-1 rounded border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px] space-y-1">
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
                            {event.metadata?.failure && (
                              <div className="col-span-2">
                                <span className="block text-[10px] uppercase tracking-wide">Failure context</span>
                                <div className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive space-y-1">
                                  {event.metadata.failure.at && <div>at: {event.metadata.failure.at}</div>}
                                  {event.metadata.failure.reason?.message && <div>message: {event.metadata.failure.reason.message}</div>}
                                  {event.metadata.failure.reason?.name && <div>name: {event.metadata.failure.reason.name}</div>}
                                </div>
                              </div>
                            )}
                          </div>

                          {nodeState && (
                            <div>
                              <span className="block text-[10px] uppercase tracking-wide">Node state</span>
                              <div className="mt-1 grid grid-cols-2 gap-3 text-muted-foreground">
                                <div>
                                  <span className="text-[10px] uppercase">Status</span>
                                  <div className="font-mono text-[11px] text-foreground">
                                    {nodeState.status}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase">Progress</span>
                                  <div className="font-mono text-[11px] text-foreground">
                                    {Math.round(nodeState.progress)}%
                                  </div>
                                </div>
                                {nodeState.retryCount > 0 && (
                                  <div>
                                    <span className="text-[10px] uppercase">Retries</span>
                                    <div className="font-mono text-[11px] text-foreground">
                                      {nodeState.retryCount}
                                    </div>
                                  </div>
                                )}
                                {nodeState.lastActivityId && nodeState.lastActivityId !== event.metadata?.activityId && (
                                  <div className="col-span-2">
                                    <span className="text-[10px] uppercase">Latest activity</span>
                                    <div className="font-mono text-[11px] text-foreground break-all">
                                      {nodeState.lastActivityId}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {event.nodeId && (
                            <div>
                              <span className="block text-[10px] uppercase tracking-wide">Data flows</span>
                              <div className="mt-1 space-y-1">
                                {relatedFlows.slice(0, 5).map((flow, index) => (
                                  <div key={`${flow.sourceNode}-${flow.targetNode}-${index}`} className="rounded border border-border/60 bg-background/60 px-2 py-1 text-[11px]">
                                    <div className="font-medium text-foreground/90">
                                      {flow.sourceNode} → {flow.targetNode}
                                    </div>
                                    <div className="text-muted-foreground">
                                      {flow.type} • {(flow.size / 1024).toFixed(1)}KB
                                    </div>
                                  </div>
                                ))}
                                {relatedFlows.length === 0 && (
                                  <div className="rounded border border-dashed border-border/60 bg-background/40 px-2 py-1 text-muted-foreground/80">
                                    No data packets recorded for this event.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
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
