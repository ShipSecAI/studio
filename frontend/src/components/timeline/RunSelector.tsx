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
import { getTriggerDisplay } from '@/utils/triggerDisplay'
import { formatDuration } from '@/utils/timeFormat'
import { RunInfoDisplay } from '@/components/timeline/RunInfoDisplay'

const STATUS_ICONS = {
  RUNNING: Loader2,
  COMPLETED: CheckCircle,
  FAILED: XCircle,
  CANCELLED: XCircle,
  TERMINATED: XCircle,
  TIMED_OUT: XCircle,
  QUEUED: Clock,
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

type TriggerFilter = 'all' | 'manual' | 'schedule'

interface RunSelectorProps {
  onRerun?: (runId: string) => void
}

export function RunSelector({ onRerun }: RunSelectorProps = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')
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

  const filteredRunsByTrigger = useMemo(() => {
    if (triggerFilter === 'all') {
      return filteredRuns
    }
    return filteredRuns.filter((run) => run.triggerType === triggerFilter)
  }, [filteredRuns, triggerFilter])

  const liveRuns = useMemo(
    () =>
      filteredRunsByTrigger
        .filter((run) => isRunLive(run))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [filteredRunsByTrigger],
  )
  const otherLiveRuns = useMemo(
    () => liveRuns.filter((run) => run.id !== currentLiveRunId),
    [liveRuns, currentLiveRunId],
  )
  const historicalRuns = useMemo(
    () =>
      filteredRunsByTrigger
        .filter((run) => !isRunLive(run))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()),
    [filteredRunsByTrigger],
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
  const selectedTriggerDisplay = selectedRun
    ? getTriggerDisplay(selectedRun.triggerType, selectedRun.triggerLabel)
    : null

  const currentLiveRun = runs.find(run => run.id === currentLiveRunId)
  const isCurrentLiveSelected =
    currentLiveRun ? selectedRunId === currentLiveRun.id : false

  const getStatusIcon = (status: string) => {
    const IconComponent = STATUS_ICONS[status as keyof typeof STATUS_ICONS]
    return IconComponent ? <IconComponent className="h-4 w-4" /> : null
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

  const matchesTriggerFilter = useCallback(
    (run?: ExecutionRun | null) => {
      if (!run) {
        return triggerFilter === 'all'
      }
      return triggerFilter === 'all' || run.triggerType === triggerFilter
    },
    [triggerFilter],
  )

  const renderRunItem = (run: ExecutionRun) => {
    return (
      <DropdownMenuItem
        key={run.id}
        onSelect={() => handleSelectRun(run.id)}
        className={cn(
          'cursor-pointer p-0 border-b border-border/50 last:border-b-0',
          selectedRunId === run.id && 'bg-accent/20',
        )}
      >
        <div className="w-full px-3 py-3 space-y-2">
          <div className="flex items-start gap-3">
            <p className="font-semibold text-sm truncate flex-1 min-w-0">
              {run.workflowName}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Copy run link"
                aria-label="Copy direct link to this run"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleCopyLink(run)
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
              </Button>
              {onRerun && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 gap-1.5"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onRerun(run.id)
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rerun
                </Button>
              )}
            </div>
          </div>
          <RunInfoDisplay run={run} currentWorkflowVersion={currentWorkflowVersion} />
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
                  {selectedTriggerDisplay && (
                    <Badge variant={selectedTriggerDisplay.variant} className="text-[10px] gap-1 max-w-[120px] truncate">
                      <span aria-hidden="true">{selectedTriggerDisplay.icon}</span>
                      <span className="truncate">{selectedTriggerDisplay.label}</span>
                    </Badge>
                  )}
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
          <div className="px-3 py-2 border-b space-y-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Trigger</span>
            <div className="flex flex-wrap gap-2">
              {(['all', 'manual', 'schedule'] as TriggerFilter[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={triggerFilter === option ? 'default' : 'outline'}
                  className="h-7 px-3 text-xs"
                  onClick={(event) => {
                    event.preventDefault()
                    setTriggerFilter(option)
                  }}
                >
                  {option === 'all' ? 'All' : option === 'manual' ? 'Manual' : 'Scheduled'}
                </Button>
              ))}
            </div>
          </div>
          {/* Current Live Run */}
          {currentLiveRun && isRunLive(currentLiveRun) && matchesTriggerFilter(currentLiveRun) && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Current Live Run
              </div>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  if (!isCurrentLiveSelected) {
                    handleSwitchToLive()
                  } else {
                    setIsOpen(false)
                  }
                }}
                className={cn(
                  "cursor-pointer p-0 border-b border-border/50",
                  isCurrentLiveSelected && "bg-accent/20",
                )}
              >
                <div className="w-full px-3 py-3 space-y-2 bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="flex items-start gap-3">
                    <p className="font-semibold text-sm truncate flex-1 min-w-0">
                      {currentLiveRun.workflowName}
                    </p>
                    <Play className={cn("h-4 w-4 text-blue-500 flex-shrink-0", isCurrentLiveSelected && "opacity-50")} />
                  </div>
                  <RunInfoDisplay run={currentLiveRun} currentWorkflowVersion={currentWorkflowVersion} />
                </div>
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
              <div className="max-h-48 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
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
            <div className="max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
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
