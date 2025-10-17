import { useState, useEffect } from 'react'
import { ChevronDown, Play, Clock, CheckCircle, XCircle, Loader2, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useExecutionTimelineStore, type ExecutionRun } from '@/store/executionTimelineStore'
import { useExecutionStore } from '@/store/executionStore'
import { cn } from '@/lib/utils'

const STATUS_ICONS = {
  RUNNING: Loader2,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
  CANCELLED: XCircle,
  TERMINATED: XCircle,
  TIMED_OUT: XCircle,
  QUEUED: Clock,
} as const

const STATUS_COLORS = {
  RUNNING: 'text-blue-500',
  COMPLETED: 'text-green-500',
  FAILED: 'text-red-500',
  CANCELLED: 'text-gray-500',
  TERMINATED: 'text-red-500',
  TIMED_OUT: 'text-orange-500',
  QUEUED: 'text-yellow-500',
} as const

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const formatRelativeTime = (timestamp: string): string => {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then

  if (diffMs < 60000) return 'just now'
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`
  return `${Math.floor(diffMs / 86400000)}d ago`
}

export function RunSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const {
    availableRuns,
    selectedRunId,
    playbackMode,
    selectRun,
    loadRuns,
    switchToLiveMode,
  } = useExecutionTimelineStore()

  const {
    runId: currentLiveRunId,
    status: currentLiveStatus,
    workflowId: currentWorkflowId,
  } = useExecutionStore()

  // Load runs on mount
  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Auto-load current live run if it exists
  useEffect(() => {
    if (currentLiveRunId && !selectedRunId) {
      selectRun(currentLiveRunId)
    }
  }, [currentLiveRunId, selectedRunId, selectRun])

  const selectedRun = availableRuns.find(run => run.id === selectedRunId)
  const currentLiveRun = availableRuns.find(run => run.id === currentLiveRunId)

  const getStatusIcon = (status: string) => {
    const IconComponent = STATUS_ICONS[status as keyof typeof STATUS_ICONS]
    return IconComponent ? <IconComponent className="h-4 w-4" /> : null
  }

  const getStatusColor = (status: string) => {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || 'text-gray-500'
  }

  const handleSelectRun = (runId: string) => {
    selectRun(runId)
    setIsOpen(false)
  }

  const handleSwitchToLive = () => {
    if (currentLiveRunId) {
      switchToLiveMode()
      selectRun(currentLiveRunId)
      setIsOpen(false)
    }
  }

  const renderRunItem = (run: ExecutionRun) => (
    <DropdownMenuItem
      key={run.id}
      onSelect={() => handleSelectRun(run.id)}
      className={cn(
        "flex items-center gap-3 p-3 cursor-pointer",
        selectedRunId === run.id && "bg-accent"
      )}
    >
      <div className={cn("flex-shrink-0", getStatusColor(run.status))}>
        {getStatusIcon(run.status)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{run.workflowName}</span>
          {run.isLive && (
            <Badge variant="outline" className="text-xs animate-pulse">
              <Wifi className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
          <span>Run #{run.id.slice(-8)}</span>
          <span>{run.nodeCount} nodes</span>
          <span>{run.eventCount} events</span>
          {run.duration && <span>{formatDuration(run.duration)}</span>}
          <span>{formatRelativeTime(run.startTime)}</span>
        </div>
      </div>

      {selectedRunId === run.id && (
        <div className="flex-shrink-0">
          <div className="h-2 w-2 bg-blue-500 rounded-full" />
        </div>
      )}
    </DropdownMenuItem>
  )

  return (
    <div className="flex items-center gap-4">
      {/* Run Selector Dropdown */}
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-64 justify-between text-left font-normal"
          >
            <span className="truncate">
              {selectedRun ? (
                <div className="flex items-center gap-2">
                  {getStatusIcon(selectedRun.status)}
                  <span className="truncate">{selectedRun.workflowName}</span>
                  {selectedRun.isLive && (
                    <Badge variant="outline" className="text-xs animate-pulse">
                      LIVE
                    </Badge>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">Select a run...</span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-96" align="start">
          {/* Current Live Run Section */}
          {currentLiveRun && currentLiveRun.id !== selectedRunId && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Current Live Run
              </div>
              <DropdownMenuItem
                onSelect={handleSwitchToLive}
                className="flex items-center gap-3 p-3 cursor-pointer bg-blue-50 dark:bg-blue-950/20"
              >
                <div className={cn("flex-shrink-0", getStatusColor(currentLiveRun.status))}>
                  {getStatusIcon(currentLiveRun.status)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{currentLiveRun.workflowName}</span>
                    <Badge variant="outline" className="text-xs animate-pulse">
                      <Wifi className="h-3 w-3 mr-1" />
                      LIVE NOW
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                    <span>Run #{currentLiveRun.id.slice(-8)}</span>
                    <span>{currentLiveRun.nodeCount} nodes</span>
                    <span>{currentLiveRun.eventCount} events</span>
                    <span>{formatRelativeTime(currentLiveRun.startTime)}</span>
                  </div>
                </div>

                <Play className="h-4 w-4 text-blue-500" />
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          {/* Historical Runs */}
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Historical Runs
          </div>

          {availableRuns.length === 0 ? (
            <div className="px-3 py-6 text-center text-muted-foreground text-sm">
              No previous runs found
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {availableRuns
                .filter(run => !run.isLive)
                .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                .map(renderRunItem)}
            </div>
          )}

          {/* Playback Mode Indicator */}
          {selectedRun && (
            <>
              <DropdownMenuSeparator />
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant={playbackMode === 'live' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {playbackMode === 'live' ? (
                      <>
                        <Wifi className="h-3 w-3 mr-1" />
                        Live Mode
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3 mr-1" />
                        Replay Mode
                      </>
                    )}
                  </Badge>

                  {playbackMode === 'replay' && selectedRun.duration && (
                    <span className="text-muted-foreground">
                      Total: {formatDuration(selectedRun.duration)}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Playback Mode Toggle */}
      {selectedRun && currentLiveRun && selectedRun.id !== currentLiveRun.id && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleSwitchToLive}
          className="flex items-center gap-2"
        >
          <Wifi className="h-4 w-4" />
          Switch to Live
        </Button>
      )}
    </div>
  )
}