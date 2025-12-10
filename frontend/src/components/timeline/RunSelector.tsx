import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, Play, Clock, CheckCircle, XCircle, Loader2, Wifi, RefreshCw, Link2 } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useRunStore, type ExecutionRun } from '@/store/runStore'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

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
  TERMINATED: 'text-gray-500',  // User-initiated stop - same as CANCELLED
  TIMED_OUT: 'text-orange-500',
  QUEUED: 'text-yellow-500',
} as const

const TERMINAL_STATUSES: ExecutionRun['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']

const isRunLive = (run?: ExecutionRun | null) => {
  if (!run) {
    return false
  }
  if (run.isLive) {
    return true
  }
  return !TERMINAL_STATUSES.includes(run.status)
}

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

interface RunSelectorProps {
  onRerun?: (runId: string) => void
}

export function RunSelector({ onRerun }: RunSelectorProps = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { runId: routeRunId } = useParams<{ id?: string; runId?: string }>()
  const { toast } = useToast()
  const {
    selectedRunId,
    playbackMode,
    selectRun,
    switchToLiveMode,
  } = useExecutionTimelineStore()
  const workflowMetadata = useWorkflowStore((state) => state.metadata)
  const workflowId = workflowMetadata.id
  const currentWorkflowVersion = workflowMetadata.currentVersion
  const workflowCacheKey = workflowId ?? '__global__'
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs)
  const runs = scopedRuns ?? []
  const fetchRuns = useRunStore((state) => state.fetchRuns)
  const isLoadingRuns =
    useRunStore((state) => state.cache[workflowCacheKey]?.isLoading) ?? false

  const {
    runId: currentLiveRunId,
    monitorRun,
  } = useExecutionStore()

  const navigateToRun = useCallback(
    (runId?: string, options?: { replace?: boolean }) => {
      if (!workflowId || workflowId === 'new') {
        return
      }
      const basePath = `/workflows/${workflowId}`
      const targetPath = runId ? `${basePath}/runs/${runId}` : basePath
      if (location.pathname === targetPath) {
        return
      }
      navigate(targetPath, { replace: options?.replace ?? false })
    },
    [workflowId, navigate, location.pathname],
  )

  const filteredRuns = useMemo(() => {
    if (!workflowId) {
      return runs
    }
    return runs.filter((run) => run.workflowId === workflowId)
  }, [runs, workflowId])

  const liveRuns = useMemo(
    () =>
      filteredRuns
        .filter((run) => isRunLive(run))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [filteredRuns],
  )
  const otherLiveRuns = useMemo(
    () => liveRuns.filter((run) => run.id !== currentLiveRunId),
    [liveRuns, currentLiveRunId],
  )
  const historicalRuns = useMemo(
    () =>
      filteredRuns
        .filter((run) => !isRunLive(run))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [filteredRuns],
  )

  // Load runs on mount
  useEffect(() => {
    fetchRuns({ workflowId }).catch(() => undefined)
  }, [fetchRuns, workflowId])

  // Auto-load a live run if it exists and nothing is selected
  useEffect(() => {
    if (selectedRunId || routeRunId) {
      return
    }
    if (currentLiveRunId) {
      const liveRun = runs.find((run) => run.id === currentLiveRunId)
      if (!workflowId || liveRun?.workflowId === workflowId) {
        const initialMode = liveRun ? (isRunLive(liveRun) ? 'live' : 'replay') : 'live'
        void selectRun(currentLiveRunId, initialMode)
        if (liveRun && isRunLive(liveRun)) {
          monitorRun(currentLiveRunId, liveRun.workflowId)
        }
        navigateToRun(currentLiveRunId, { replace: true })
        return
      }
    }
    if (liveRuns.length > 0) {
      void selectRun(liveRuns[0].id, 'live')
      monitorRun(liveRuns[0].id, liveRuns[0].workflowId)
      navigateToRun(liveRuns[0].id, { replace: true })
    }
  }, [
    currentLiveRunId,
    selectedRunId,
    selectRun,
    workflowId,
    runs,
    liveRuns,
    monitorRun,
    navigateToRun,
    routeRunId,
  ])

  // Fallback to the most recent historical run when nothing is selected
  useEffect(() => {
    if (selectedRunId || currentLiveRunId || filteredRuns.length === 0 || routeRunId) {
      return
    }

    const [latestRun] = [...filteredRuns].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    )

    if (latestRun) {
      selectRun(latestRun.id)
      navigateToRun(latestRun.id, { replace: true })
    }
  }, [filteredRuns, selectedRunId, currentLiveRunId, selectRun, navigateToRun, routeRunId])

  useEffect(() => {
    if (!workflowId && !currentLiveRunId && liveRuns.length === 0) {
      return
    }
    const interval = window.setInterval(() => {
      fetchRuns({ workflowId, force: true }).catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(interval)
  }, [workflowId, currentLiveRunId, liveRuns.length, fetchRuns])

  const selectedRun =
    filteredRuns.find(run => run.id === selectedRunId) ??
    runs.find(run => run.id === selectedRunId)
  const selectedRunVersion = typeof selectedRun?.workflowVersion === 'number' ? selectedRun.workflowVersion : null
  const selectedRunOlder =
    selectedRunVersion !== null &&
    typeof currentWorkflowVersion === 'number' &&
    selectedRunVersion !== currentWorkflowVersion

  const currentLiveRun = runs.find(run => run.id === currentLiveRunId)
  const currentLiveRunVersion = typeof currentLiveRun?.workflowVersion === 'number'
    ? currentLiveRun.workflowVersion
    : null
  const currentLiveRunOlder =
    currentLiveRunVersion !== null &&
    typeof currentWorkflowVersion === 'number' &&
    currentLiveRunVersion !== currentWorkflowVersion

  const getStatusIcon = (status: string) => {
    const IconComponent = STATUS_ICONS[status as keyof typeof STATUS_ICONS]
    return IconComponent ? <IconComponent className="h-4 w-4" /> : null
  }

  const getStatusColor = (status: string) => {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || 'text-gray-500'
  }

  const handleCopyLink = useCallback(
    async (run: ExecutionRun) => {
      const basePath = `/workflows/${run.workflowId}/runs/${run.id}`
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
    },
    [toast],
  )

  const handleSelectRun = (runId: string) => {
    const run = runs.find((r) => r.id === runId)
    const runIsLive = isRunLive(run)
    void selectRun(runId, runIsLive ? 'live' : 'replay')

    if (runIsLive && run) {
      monitorRun(runId, run.workflowId)
    }

    navigateToRun(runId)
    setIsOpen(false)
  }

  const handleSwitchToLive = () => {
    if (currentLiveRunId) {
      switchToLiveMode()
      void selectRun(currentLiveRunId, 'live')
      navigateToRun(currentLiveRunId)
      setIsOpen(false)
    }
  }

  const renderRunItem = (run: ExecutionRun) => {
    const runVersion = run.workflowVersion
    const hasVersion = typeof runVersion === 'number'
    const isOlderVersion =
      hasVersion && typeof currentWorkflowVersion === 'number' && runVersion !== currentWorkflowVersion

    return (
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
            {hasVersion && (
              <Badge
                variant={isOlderVersion ? 'destructive' : 'secondary'}
                className="text-[10px] uppercase tracking-wide"
              >
                v{runVersion}
              </Badge>
            )}
            {isRunLive(run) && (
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
            {hasVersion && (
              <span className={cn(isOlderVersion ? 'text-amber-500' : undefined)}>
                v{runVersion}
                {isOlderVersion && typeof currentWorkflowVersion === 'number'
                  ? ` (current v${currentWorkflowVersion})`
                  : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 items-end justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              handleCopyLink(run)
            }}
            title="Copy run link"
            aria-label="Copy direct link to this run"
          >
            <Link2 className="h-4 w-4" />
          </Button>
          {onRerun && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRerun(run.id)
              }}
              title="Re-run this execution"
              aria-label="Re-run this execution"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {selectedRunId === run.id && (
            <div className="flex-shrink-0">
              <div className="h-2 w-2 bg-blue-500 rounded-full" />
            </div>
          )}
        </div>
      </DropdownMenuItem>
    )
  }

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
                  {selectedRunVersion !== null && (
                    <Badge
                      variant={selectedRunOlder ? 'destructive' : 'secondary'}
                      className="text-[10px] uppercase tracking-wide"
                    >
                      v{selectedRunVersion}
                    </Badge>
                  )}
                  {isRunLive(selectedRun) && (
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
          {/* Current Live Run */}
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
                    {currentLiveRunVersion !== null && (
                      <Badge
                        variant={currentLiveRunOlder ? 'destructive' : 'secondary'}
                        className="text-[10px] uppercase tracking-wide"
                      >
                        v{currentLiveRunVersion}
                      </Badge>
                    )}
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
                    {currentLiveRunVersion !== null && (
                      <span className={cn(currentLiveRunOlder ? 'text-amber-500' : undefined)}>
                        v{currentLiveRunVersion}
                        {currentLiveRunOlder && typeof currentWorkflowVersion === 'number'
                          ? ` (current v${currentWorkflowVersion})`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>

                <Play className="h-4 w-4 text-blue-500" />
              </DropdownMenuItem>

              <DropdownMenuSeparator />
            </>
          )}

          {/* Live Runs */}
          {otherLiveRuns.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Live Runs
              </div>
              <div className="max-h-48 overflow-y-auto">
                {otherLiveRuns.map(renderRunItem)}
              </div>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Historical Runs */}
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Historical Runs
          </div>

          {historicalRuns.length === 0 ? (
            <div className="px-3 py-6 text-center text-muted-foreground text-sm">
              {isLoadingRuns ? 'Loading runs…' : 'No previous runs found'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {historicalRuns.map(renderRunItem)}
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

      {liveRuns.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {liveRuns.length} live run{liveRuns.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
