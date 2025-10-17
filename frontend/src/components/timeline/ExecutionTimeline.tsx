import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { cn } from '@/lib/utils'

const PLAYBACK_SPEEDS = [
  { label: '0.1x', value: 0.1 },
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: '10x', value: 10 },
]

const formatTime = (ms: number): string => {
  if (ms < 1000) return `0:${String(Math.floor(ms / 100)).padStart(2, '0')}`
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
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

export function ExecutionTimeline() {
  const [isDragging, setIsDragging] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const animationFrameRef = useRef<number>()

  const {
    selectedRunId,
    events,
    totalDuration,
    currentTime,
    playbackMode,
    isPlaying,
    playbackSpeed,
    isSeeking,
    nodeStates,
    showTimeline,
    timelineZoom,
    play,
    pause,
    seek,
    setPlaybackSpeed,
    stepForward,
    stepBackward,
    toggleTimeline,
    setTimelineZoom,
  } = useExecutionTimelineStore()

  // Animation loop for playback
  useEffect(() => {
    if (isPlaying && playbackMode === 'replay' && !isDragging) {
      const animate = () => {
        const newState = useExecutionTimelineStore.getState()
        const newTime = newState.currentTime + (16.67 * playbackSpeed) // 60fps timing

        if (newTime >= totalDuration) {
          pause()
          seek(totalDuration)
        } else {
          seek(newTime)
          animationFrameRef.current = requestAnimationFrame(animate)
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, playbackMode, playbackSpeed, isDragging, totalDuration, seek, pause])

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || playbackMode === 'live') return

    const rect = timelineRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const newTime = percentage * totalDuration

    seek(newTime)
  }, [totalDuration, seek, playbackMode])

  const handleScrubberChange = useCallback((value: number[]) => {
    if (playbackMode === 'live') return
    seek(value[0])
  }, [seek, playbackMode])

  const handleMouseDown = useCallback(() => {
    if (playbackMode === 'live') return
    setIsDragging(true)
    pause()
  }, [pause, playbackMode])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handlePlayPause = useCallback(() => {
    if (playbackMode === 'live') return

    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, play, pause, playbackMode])

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed)
  }, [setPlaybackSpeed])

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    const newZoom = direction === 'in'
      ? Math.min(2.0, timelineZoom * 1.2)
      : Math.max(0.5, timelineZoom / 1.2)
    setTimelineZoom(newZoom)
  }, [timelineZoom, setTimelineZoom])

  // Calculate progress percentage
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  // Generate event markers
  const eventMarkers = events.map((event, index) => {
    const percentage = totalDuration > 0
      ? Math.min(100, Math.max(0, (event.offsetMs / totalDuration) * 100))
      : 0

    let markerColor = 'bg-gray-400'
    if (event.type === 'COMPLETED') markerColor = 'bg-green-500'
    else if (event.type === 'FAILED') markerColor = 'bg-red-500'
    else if (event.type === 'STARTED') markerColor = 'bg-blue-500'

    return { percentage, color: markerColor, event }
  })

  if (!selectedRunId || !showTimeline) {
    return null
  }

  return (
    <div className="border-t bg-background">
      <div className="p-4 space-y-4">
        {/* Header with controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Playback Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={stepBackward}
                disabled={playbackMode === 'live' || currentTime <= 0}
              >
                <SkipBack className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={handlePlayPause}
                disabled={playbackMode === 'live'}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={stepForward}
                disabled={playbackMode === 'live' || currentTime >= totalDuration}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            {/* Speed Control */}
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
                    className={cn(
                      playbackSpeed === speed.value && "bg-accent"
                    )}
                  >
                    {speed.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mode Indicator */}
            <Badge
              variant={playbackMode === 'live' ? 'default' : 'secondary'}
              className="flex items-center gap-1"
            >
              {playbackMode === 'live' ? (
                <>
                  <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
                  LIVE
                </>
              ) : (
                'REVIEW'
              )}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {/* Zoom Controls */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleZoom('out')}
              disabled={timelineZoom <= 0.5}
            >
              <Minimize2 className="h-4 w-4" />
            </Button>

            <span className="text-xs text-muted-foreground w-8 text-center">
              {Math.round(timelineZoom * 100)}%
            </span>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleZoom('in')}
              disabled={timelineZoom >= 2.0}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>

            {/* Hide Timeline */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTimeline}
            >
              <VolumeX className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          {/* Time display */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {playbackMode === 'live' ? (
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              ) : (
                formatTime(currentTime)
              )}
            </span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          {/* Timeline Track */}
          <div
            ref={timelineRef}
            className="relative h-8 bg-muted rounded cursor-pointer"
            onClick={handleTimelineClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            style={{ height: `${32 * timelineZoom}px` }}
          >
            {/* Progress Bar */}
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded transition-all duration-100"
              style={{ width: `${progress}%` }}
            />

            {/* Event Markers */}
            {eventMarkers.map((marker, index) => (
              <div
                key={index}
                className={cn(
                  "absolute top-1 bottom-1 w-1 rounded-full opacity-70",
                  marker.color
                )}
                style={{
                  left: `${marker.percentage}%`,
                  transform: 'translateX(-50%)',
                }}
                title={`${marker.event.type} - ${marker.event.nodeId || 'System'} - ${formatTimestamp(marker.event.timestamp)}`}
              />
            ))}

            {/* Scrubber */}
            {playbackMode === 'replay' && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-white border-2 border-blue-500 rounded-full cursor-grab active:cursor-grabbing shadow-md"
                style={{
                  left: `${progress}%`,
                  transform: 'translateX(-50%)',
                }}
                onMouseDown={handleMouseDown}
              >
                <div className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 rounded-full" />
              </div>
            )}

            {/* Current Position Indicator for Live Mode */}
            {playbackMode === 'live' && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                style={{
                  left: '100%',
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              </div>
            )}
          </div>

          {/* Scrubber for precise control */}
          {playbackMode === 'replay' && (
            <Slider
              value={[currentTime]}
              onValueChange={handleScrubberChange}
              max={totalDuration}
              step={100}
              className="w-full"
              disabled={playbackMode === 'live'}
            />
          )}
        </div>

        {/* Additional info */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{events.length} events</span>
            <span>{Object.keys(nodeStates).length} nodes</span>
            {playbackMode === 'replay' && (
              <span>Speed: {playbackSpeed}x</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            {isSeeking && (
              <span className="text-blue-500">Seeking...</span>
            )}
            {isPlaying && playbackMode === 'replay' && (
              <span className="text-green-500">Playing...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
