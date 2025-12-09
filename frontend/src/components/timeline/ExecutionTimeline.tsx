import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { cn } from '@/lib/utils'

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const PLAYBACK_SPEEDS = [
  { label: '0.1x', value: 0.1 },
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: '10x', value: 10 },
]

const EVENT_COLORS: Record<string, string> = {
  STARTED: 'bg-blue-500',
  PROGRESS: 'bg-purple-500',
  COMPLETED: 'bg-green-500',
  FAILED: 'bg-red-500',
  default: 'bg-gray-400 dark:bg-gray-500',
}

const formatTime = (ms: number): string => {
  if (ms < 1000) return `0:${String(Math.floor(ms / 100)).padStart(2, '0')}`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
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

export function ExecutionTimeline() {
  const [timelineStart, setTimelineStart] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)

  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId)
  const events = useExecutionTimelineStore((state) => state.events)
  const totalDuration = useExecutionTimelineStore((state) => state.totalDuration)
  const eventDuration = useExecutionTimelineStore((state) => state.eventDuration)
  const currentTime = useExecutionTimelineStore((state) => state.currentTime)
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode)
  const isPlaying = useExecutionTimelineStore((state) => state.isPlaying)
  const playbackSpeed = useExecutionTimelineStore((state) => state.playbackSpeed)
  const isSeeking = useExecutionTimelineStore((state) => state.isSeeking)
  const nodeStates = useExecutionTimelineStore((state) => state.nodeStates)
  const showTimeline = useExecutionTimelineStore((state) => state.showTimeline)
  const timelineZoom = useExecutionTimelineStore((state) => state.timelineZoom)
  const play = useExecutionTimelineStore((state) => state.play)
  const pause = useExecutionTimelineStore((state) => state.pause)
  const seek = useExecutionTimelineStore((state) => state.seek)
  const setPlaybackSpeed = useExecutionTimelineStore((state) => state.setPlaybackSpeed)
  const stepForward = useExecutionTimelineStore((state) => state.stepForward)
  const stepBackward = useExecutionTimelineStore((state) => state.stepBackward)
  const setTimelineZoom = useExecutionTimelineStore((state) => state.setTimelineZoom)
  const isLiveFollowing = useExecutionTimelineStore((state) => state.isLiveFollowing)
  const goLive = useExecutionTimelineStore((state) => state.goLive)
  const tickLiveClock = useExecutionTimelineStore((state) => state.tickLiveClock)
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime)
  const agentMarkersRunId = useExecutionTimelineStore((state) => state.agentMarkersRunId)
  const agentMarkers = useExecutionTimelineStore((state) => state.agentMarkers)

  const isLiveMode = playbackMode === 'live'
  const overviewDuration = Math.max(eventDuration, totalDuration)
  const safeDuration = Math.max(totalDuration, 1)
  const normalizedProgress = clampValue(currentTime / safeDuration, 0, 1)
  const viewportWidth = 1 / timelineZoom
  const maxStart = Math.max(0, 1 - viewportWidth)
  const clampedStart = clampValue(timelineStart, 0, maxStart)
  const visibleProgress = clampValue(
    viewportWidth >= 1 ? normalizedProgress : (normalizedProgress - clampedStart) / viewportWidth,
    0,
    1,
  )
  const viewportStartMs = clampedStart * safeDuration
  const viewportEndMs = Math.min(safeDuration, (clampedStart + viewportWidth) * safeDuration)

  useEffect(() => {
    if (!selectedRunId) return
    setTimelineStart(0)
    setTimelineZoom(1)
  }, [selectedRunId, setTimelineZoom])

  useEffect(() => {
    setTimelineStart((prev) => clampValue(prev, 0, maxStart))
  }, [maxStart])

  useEffect(() => {
    // Always advance the live clock so overall duration keeps moving even when user scrubs away from follow mode.
    if (!isLiveMode) return
    let frame: number
    const pump = () => {
      tickLiveClock()
      frame = requestAnimationFrame(pump)
    }
    frame = requestAnimationFrame(pump)
    return () => cancelAnimationFrame(frame)
  }, [isLiveMode, tickLiveClock])

  useEffect(() => {
    const guard = viewportWidth >= 1 ? 0 : viewportWidth * 0.15
    const lowerBound = clampedStart + guard
    const upperBound = clampedStart + viewportWidth - guard
    if (normalizedProgress < lowerBound) {
      setTimelineStart(clampValue(normalizedProgress - guard, 0, maxStart))
    } else if (normalizedProgress > upperBound) {
      setTimelineStart(clampValue(normalizedProgress - (viewportWidth - guard), 0, maxStart))
    }
  }, [normalizedProgress, viewportWidth, clampedStart, maxStart])

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return null
      const relative = clampValue((clientX - rect.left) / rect.width, 0, 1)
      const normalized = clampValue(clampedStart + relative * viewportWidth, 0, 1)
      return normalized * safeDuration
    },
    [clampedStart, viewportWidth, safeDuration],
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const next = getTimeFromClientX(clientX)
      if (next == null) return
      seek(next)
    },
    [getTimeFromClientX, seek],
  )

  const handleTrackMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      setIsDragging(true)
      seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )

  useEffect(() => {
    if (!isDragging) return
    const onMove = (event: MouseEvent) => {
      seekFromClientX(event.clientX)
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, seekFromClientX])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const rect = timelineRef.current.getBoundingClientRect()
        const pivotRatio = clampValue((event.clientX - rect.left) / rect.width, 0, 1)
        const pivotPoint = clampedStart + pivotRatio * viewportWidth
        const delta = event.deltaY > 0 ? -0.5 : 0.5
        const nextZoom = clampValue(timelineZoom + delta, 1, 100)
        if (nextZoom === timelineZoom) return
        const nextViewportWidth = 1 / nextZoom
        const nextMaxStart = Math.max(0, 1 - nextViewportWidth)
        const nextStart = clampValue(pivotPoint - nextViewportWidth * pivotRatio, 0, nextMaxStart)
        setTimelineZoom(nextZoom)
        setTimelineStart(nextStart)
      } else if (timelineZoom > 1) {
        event.preventDefault()
        const delta = (event.deltaY / 500) * viewportWidth
        setTimelineStart((prev) => clampValue(prev + delta, 0, maxStart))
      }
    },
    [timelineZoom, viewportWidth, clampedStart, maxStart, setTimelineZoom],
  )

  const handlePlayPause = useCallback(() => {
    if (playbackMode === 'live') return
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, play, pause, playbackMode])

  const handleSpeedChange = useCallback(
    (speed: number) => {
      setPlaybackSpeed(speed)
    },
    [setPlaybackSpeed],
  )

  const markerData = useMemo(() => {
    if (events.length === 0) return []
    return events.map((event) => {
      const normalized = clampValue(event.offsetMs / safeDuration, 0, 1)
      const viewportPosition =
        viewportWidth >= 1 ? normalized : (normalized - clampedStart) / viewportWidth
      return {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        viewportPosition,
        normalizedPosition: normalized,
        visible: viewportPosition >= 0 && viewportPosition <= 1,
      }
    })
  }, [events, safeDuration, clampedStart, viewportWidth])

  const visibleMarkers = markerData.filter((marker) => marker.visible)
  const baseTimelineStart =
    timelineStartTime ??
    (events.length > 0 ? new Date(events[0].timestamp).getTime() : null)
  const agentMarkerData = useMemo(() => {
    if (!baseTimelineStart) {
      return []
    }
    if (!selectedRunId || agentMarkersRunId !== selectedRunId) {
      return []
    }
    const flatMarkers = Object.values(agentMarkers).flat()
    return flatMarkers.map((marker) => {
      const markerTime = new Date(marker.timestamp).getTime()
      const offsetMs = markerTime - baseTimelineStart
      const normalized = clampValue(offsetMs / safeDuration, 0, 1)
      const viewportPosition =
        viewportWidth >= 1 ? normalized : (normalized - clampedStart) / viewportWidth
      return {
        id: marker.id,
        label: marker.label,
        timestamp: marker.timestamp,
        viewportPosition,
        normalizedPosition: normalized,
        visible: viewportPosition >= 0 && viewportPosition <= 1,
      }
    })
  }, [
    agentMarkers,
    agentMarkersRunId,
    baseTimelineStart,
    clampedStart,
    safeDuration,
    selectedRunId,
    viewportWidth,
  ])
  const visibleAgentMarkers = agentMarkerData.filter((marker) => marker.visible)

  const handlePreviewPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width) return
      const ratio = clampValue((event.clientX - rect.left) / rect.width, 0, 1)
      const nextStart = clampValue(ratio - viewportWidth / 2, 0, maxStart)
      setTimelineStart(nextStart)
    },
    [viewportWidth, maxStart],
  )

  useEffect(() => {
    if (!isPlaying || playbackMode !== 'replay') return
    let frame: number
    const step = () => {
      const state = useExecutionTimelineStore.getState()
      const delta = 16.67 * state.playbackSpeed
      const nextTime = Math.min(state.totalDuration, state.currentTime + delta)
      if (nextTime >= state.totalDuration) {
        pause()
        seek(state.totalDuration)
        return
      }
      seek(nextTime)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, playbackMode, pause, seek])

  if (!selectedRunId || !showTimeline) {
    return null
  }

  return (
    <div className="border-t bg-background">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={stepBackward}
                disabled={currentTime <= 0}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePlayPause}
                disabled={playbackMode === 'live'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={stepForward}
                disabled={currentTime >= totalDuration}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={playbackMode === 'live'}
                  className="w-16 justify-between"
                >
                  {playbackSpeed}x
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {PLAYBACK_SPEEDS.map((speed) => (
                  <DropdownMenuItem
                    key={speed.value}
                    onClick={() => handleSpeedChange(speed.value)}
                    className={cn(playbackSpeed === speed.value && 'bg-accent')}
                  >
                    {speed.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge
              variant={isLiveMode ? 'default' : 'secondary'}
              className="flex items-center gap-1"
            >
              {isLiveMode ? (
                <>
                  <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
                  LIVE
                </>
              ) : (
                'EXECUTION'
              )}
            </Badge>
            {isLiveMode && !isLiveFollowing && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-red-500 border-red-400 bg-red-50">
                  Behind live
                </Badge>
                <Button size="sm" onClick={goLive} className="bg-red-500 text-white hover:bg-red-600">
                  Go Live
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 relative">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatTime(viewportStartMs)}</span>
            <span>{formatTime(viewportEndMs)}</span>
          </div>
          <div
            ref={timelineRef}
            className="relative h-14 bg-muted rounded-lg border transition-all hover:border-blue-300/50 overflow-hidden"
            onMouseDown={handleTrackMouseDown}
            onWheel={handleWheel}
          >
            <div
              className="absolute inset-y-3 left-0 bg-gradient-to-r from-blue-400/30 to-blue-500/40 rounded-r-full"
              style={{ width: `${visibleProgress * 100}%` }}
            />
            {visibleMarkers.map((marker) => (
              <div
                key={marker.id}
                className={cn(
                  'absolute top-3 bottom-3 w-[2px] rounded-full',
                  EVENT_COLORS[marker.type] ?? EVENT_COLORS.default,
                )}
                style={{ left: `${marker.viewportPosition * 100}%` }}
                title={`${marker.type} • ${formatTimestamp(marker.timestamp)}`}
              />
            ))}
            {visibleAgentMarkers.map((marker) => (
              <div
                key={`agent-${marker.id}`}
                className="absolute top-1 bottom-1 flex items-center justify-center"
                style={{ left: `${marker.viewportPosition * 100}%` }}
                title={`${marker.label} • ${formatTimestamp(marker.timestamp)}`}
              >
                <div className="w-3 h-3 rotate-45 border border-amber-500 bg-amber-200 shadow-sm" />
              </div>
            ))}
            {(playbackMode === 'replay' || isLiveMode) && (
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute inset-y-2 w-10 -ml-5 flex flex-col items-center gap-2"
                  style={{ left: `${visibleProgress * 100}%` }}
                >
                  <div
                    className={cn(
                      'flex-1 w-[3px] rounded-full shadow-lg',
                      isLiveMode ? 'bg-red-400' : 'bg-blue-400',
                    )}
                  />
                </div>
              </div>
            )}
          </div>
          {(playbackMode === 'replay' || isLiveMode) && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${visibleProgress * 100}%`,
                top: 'calc(100% - 6px)',
                transform: 'translateX(-50%)',
                zIndex: 20,
              }}
            >
              <button
                type="button"
                className={cn(
                  'pointer-events-auto relative px-2 py-1 text-xs text-white rounded-md shadow-md whitespace-nowrap',
                  isLiveMode ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600',
                )}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setIsDragging(true)
                  seekFromClientX(event.clientX)
                }}
              >
                {formatTime(currentTime)}
                <span
                  className="absolute -top-1 left-1/2 block h-2 w-2"
                  style={{
                    transform: 'translateX(-50%) rotate(45deg)',
                    backgroundColor: isLiveMode ? '#ef4444' : '#3b82f6',
                  }}
                />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 mt-4 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Timeline Overview</span>
            <span className="text-blue-600 dark:text-blue-400">
              {timelineZoom > 1 ? `Zoom: ${Math.round(timelineZoom * 100)}%` : ''}
            </span>
          </div>
          <div
            className="relative h-8 bg-muted rounded-lg border cursor-pointer"
            onMouseDown={handlePreviewPointer}
            onMouseMove={(event) => {
              if (event.buttons & 1) {
                handlePreviewPointer(event)
              }
            }}
            title="Click or drag to reposition view"
          >
            {markerData.map((marker) => (
              <div
                key={`preview-${marker.id}`}
                className={cn(
                  'absolute top-2 bottom-2 w-[2px] rounded-full opacity-30',
                  EVENT_COLORS[marker.type] ?? EVENT_COLORS.default,
                )}
                style={{ left: `${marker.normalizedPosition * 100}%` }}
              />
            ))}
            <div
              className="absolute top-0 bottom-0 bg-blue-500/20 border border-blue-400/40 rounded"
              style={{ left: `${clampedStart * 100}%`, width: `${viewportWidth * 100}%` }}
            />
          </div>
          <div
            className="relative h-3 pointer-events-none"
            aria-hidden="true"
          >
            <div
              className="absolute"
              style={{
                left: `${normalizedProgress * 100}%`,
                top: 0,
                transform: 'translate(-50%, 0)',
                color: isLiveMode ? '#ef4444' : '#3b82f6',
              }}
            >
              <div
                className="w-0 h-0"
                style={{
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderBottom: '8px solid currentColor',
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{formatTime(0)}</span>
            <span>{formatTime(overviewDuration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{events.length} events</span>
            <span>{Object.keys(nodeStates).length} nodes</span>
            {playbackMode === 'replay' && <span>Speed: {playbackSpeed}x</span>}
          </div>
          <div className="flex items-center gap-4">
            {isSeeking && <span className="text-blue-500">Seeking...</span>}
            {isPlaying && playbackMode === 'replay' && (
              <span className="text-green-500">Playing...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
