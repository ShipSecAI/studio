import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Edit3,
  Plus,
  Trash2,
} from 'lucide-react'
import { useScheduleStore } from '@/store/scheduleStore'
import { useToast } from '@/components/ui/use-toast'
import { api } from '@/services/api'
import { ScheduleEditorDrawer, type WorkflowOption } from '@/components/schedules/ScheduleEditorDrawer'
import type { WorkflowSchedule } from '@shipsec/shared'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
]

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
  }).format(date)
}

const getWorkflowName = (
  workflowId: string,
  workflows: WorkflowOption[],
): string => {
  const match = workflows.find((workflow) => workflow.id === workflowId)
  return match?.name ?? 'Unknown workflow'
}

export function SchedulesPage() {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([])
  const [workflowsLoading, setWorkflowsLoading] = useState(true)
  const [actionState, setActionState] = useState<Record<string, 'run' | 'toggle'>>({})
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [activeSchedule, setActiveSchedule] = useState<WorkflowSchedule | null>(null)

  const schedules = useScheduleStore((state) => state.schedules)
  const isLoading = useScheduleStore((state) => state.isLoading)
  const error = useScheduleStore((state) => state.error)
  const filters = useScheduleStore((state) => state.filters)
  const fetchSchedules = useScheduleStore((state) => state.fetchSchedules)
  const refreshSchedules = useScheduleStore((state) => state.refreshSchedules)
  const setFilters = useScheduleStore((state) => state.setFilters)
  const pauseSchedule = useScheduleStore((state) => state.pauseSchedule)
  const resumeSchedule = useScheduleStore((state) => state.resumeSchedule)
  const runSchedule = useScheduleStore((state) => state.runSchedule)
  const deleteSchedule = useScheduleStore((state) => state.deleteSchedule)
  const upsertSchedule = useScheduleStore((state) => state.upsertSchedule)

  useEffect(() => {
    const initialWorkflowId = searchParams.get('workflowId')
    if (initialWorkflowId) {
      setFilters({ workflowId: initialWorkflowId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchSchedules({ force: true }).catch(() => {
      /* errors handled in store */
    })
  }, [fetchSchedules, filters.workflowId, filters.status])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const workflowList = await api.workflows.list()
        if (cancelled) return
        const normalized = workflowList.map((workflow) => ({
          id: workflow.id,
          name: workflow.name ?? 'Untitled workflow',
        }))
        setWorkflowOptions(normalized)
      } catch (err) {
        console.error('Failed to load workflows', err)
        toast({
          title: 'Unable to load workflows',
          description:
            err instanceof Error ? err.message : 'Please try refreshing the page.',
          variant: 'destructive',
        })
      } finally {
        if (!cancelled) {
          setWorkflowsLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast])

  const filteredSchedules = useMemo(() => {
    const query = filters.search.trim().toLowerCase()

    return schedules.filter((schedule) => {
      const workflowName = getWorkflowName(schedule.workflowId, workflowOptions)
      const matchesSearch =
        query.length === 0 ||
        schedule.name.toLowerCase().includes(query) ||
        workflowName.toLowerCase().includes(query)

      return matchesSearch
    })
  }, [filters.search, schedules, workflowOptions])

  const markAction = (id: string, action: 'run' | 'toggle') => {
    setActionState((state) => ({ ...state, [id]: action }))
  }

  const clearAction = (id: string) => {
    setActionState((state) => {
      const next = { ...state }
      delete next[id]
      return next
    })
  }

  const handleWorkflowFilterChange = (value: string) => {
    const workflowId = value === 'all' ? null : value
    setFilters({ workflowId })
    const nextParams = new URLSearchParams(searchParams)
    if (workflowId) {
      nextParams.set('workflowId', workflowId)
    } else {
      nextParams.delete('workflowId')
    }
    setSearchParams(nextParams, { replace: true })
  }

  const handleStatusFilterChange = (value: string) => {
    setFilters({ status: value as typeof filters.status })
  }

  const openCreateDrawer = () => {
    setEditorMode('create')
    setActiveSchedule(null)
    setEditorOpen(true)
  }

  const openEditDrawer = (schedule: WorkflowSchedule) => {
    setEditorMode('edit')
    setActiveSchedule(schedule)
    setEditorOpen(true)
  }

  const handleScheduleSaved = (
    savedSchedule: WorkflowSchedule,
    mode: 'create' | 'edit',
  ) => {
    upsertSchedule(savedSchedule)
    toast({
      title: mode === 'create' ? 'Schedule created' : 'Schedule updated',
      description:
        mode === 'create'
          ? `"${savedSchedule.name}" is now active.`
          : `"${savedSchedule.name}" has been updated.`,
    })
  }

  const handlePauseResume = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'toggle')
    try {
      if (schedule.status === 'active') {
        await pauseSchedule(schedule.id)
        toast({
          title: 'Schedule paused',
          description: `"${schedule.name}" has been paused.`,
        })
      } else {
        await resumeSchedule(schedule.id)
        toast({
          title: 'Schedule resumed',
          description: `"${schedule.name}" is active again.`,
        })
      }
    } catch (err) {
      toast({
        title: 'Schedule update failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    } finally {
      clearAction(schedule.id)
    }
  }

  const handleRunNow = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'run')
    try {
      await runSchedule(schedule.id)
      toast({
        title: 'Run requested',
        description: `Scheduled cadence "${schedule.name}" is executing now.`,
      })
    } catch (err) {
      toast({
        title: 'Failed to trigger schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    } finally {
      clearAction(schedule.id)
    }
  }

  const handleRefresh = async () => {
    try {
      await refreshSchedules()
      toast({
        title: 'Schedules refreshed',
        description: 'Latest schedule statuses have been loaded.',
      })
    } catch (err) {
      toast({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    }
  }

  const handleEdit = (schedule: WorkflowSchedule) => {
    openEditDrawer(schedule)
  }

  const handleDelete = async (schedule: WorkflowSchedule) => {
    if (!confirm(`Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`)) {
      return
    }
    markAction(schedule.id, 'run')
    try {
      await deleteSchedule(schedule.id)
      toast({
        title: 'Schedule deleted',
        description: `"${schedule.name}" has been deleted.`,
      })
    } catch (err) {
      toast({
        title: 'Failed to delete schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      })
    } finally {
      clearAction(schedule.id)
    }
  }

  const isActionBusy = (id: string) => Boolean(actionState[id])

  const renderStatusBadge = (status: string) => {
    const variant = STATUS_VARIANTS[status] || 'outline'
    const label = status.charAt(0).toUpperCase() + status.slice(1)
    return <Badge variant={variant}>{label}</Badge>
  }

  const hasData = filteredSchedules.length > 0

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background">
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1 space-y-2">
              <label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                <Search className="h-3.5 w-3.5" />
                Search schedules or workflows
              </label>
              <Input
                placeholder="Filter by schedule or workflow"
                value={filters.search}
                onChange={(event) => setFilters({ search: event.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                variant="default"
                className="gap-2"
                onClick={openCreateDrawer}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New schedule</span>
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                Try again
              </Button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={handleStatusFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Workflow</label>
              <Select
                value={filters.workflowId ?? 'all'}
                onValueChange={handleWorkflowFilterChange}
                disabled={workflowsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All workflows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflows</SelectItem>
                  {workflowOptions.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Name</TableHead>
                  <TableHead className="min-w-[120px] hidden md:table-cell">Workflow</TableHead>
                  <TableHead className="min-w-[100px] hidden lg:table-cell">Cadence</TableHead>
                  <TableHead className="min-w-[100px] hidden sm:table-cell">Next run</TableHead>
                  <TableHead className="min-w-[100px] hidden lg:table-cell">Last run</TableHead>
                  <TableHead className="min-w-[80px]">Status</TableHead>
                  <TableHead className="text-right min-w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !hasData
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        {Array.from({ length: 7 }).map((_, cell) => (
                          <TableCell key={`cell-${cell}`}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : null}
                {!isLoading && hasData
                  ? filteredSchedules.map((schedule) => {
                      const workflowName = getWorkflowName(
                        schedule.workflowId,
                        workflowOptions,
                      )
                      const cadenceLabel = schedule.humanLabel
                        ? `${schedule.humanLabel} (${schedule.cronExpression})`
                        : schedule.cronExpression

                      const isPaused = schedule.status !== 'active'

                      return (
                        <TableRow key={schedule.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span className="truncate max-w-[120px] md:max-w-none">{schedule.name}</span>
                              {schedule.description && (
                                <span className="text-xs text-muted-foreground truncate max-w-[120px] md:max-w-none">
                                  {schedule.description}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex flex-col">
                              <span className="font-medium truncate max-w-[120px]">{workflowName}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                {schedule.workflowId}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <div className="flex flex-col">
                              <span className="text-sm">{cadenceLabel}</span>
                              <span className="text-xs text-muted-foreground">
                                {schedule.timezone}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm hidden sm:table-cell">{formatDateTime(schedule.nextRunAt)}</TableCell>
                          <TableCell className="text-sm hidden lg:table-cell">{formatDateTime(schedule.lastRunAt)}</TableCell>
                          <TableCell>{renderStatusBadge(schedule.status)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1 md:gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1 h-8 px-2 md:px-3"
                                onClick={() => handleRunNow(schedule)}
                                disabled={isActionBusy(schedule.id)}
                              >
                                <PlayCircle className="h-4 w-4" />
                                <span className="hidden md:inline">Run</span>
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1 h-8 px-2 md:px-3"
                                onClick={() => handlePauseResume(schedule)}
                                disabled={isActionBusy(schedule.id)}
                              >
                                {isPaused ? (
                                  <>
                                    <PlayCircle className="h-4 w-4" />
                                    <span className="hidden md:inline">Resume</span>
                                  </>
                                ) : (
                                  <>
                                    <PauseCircle className="h-4 w-4" />
                                    <span className="hidden md:inline">Pause</span>
                                  </>
                                )}
                              </Button>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Edit schedule"
                                    onClick={() => handleEdit(schedule)}
                                    className="h-8 w-8"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Edit schedule configuration
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Delete schedule"
                                    onClick={() => handleDelete(schedule)}
                                    disabled={isActionBusy(schedule.id)}
                                    className="h-8 w-8"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Delete schedule
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  : null}
                {!isLoading && !hasData && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                        <p className="font-medium">No schedules found</p>
                        <p className="text-sm text-muted-foreground max-w-lg">
                          Create your first cadence with the “New schedule” button or tweak the filters above.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </div>
        </div>
      </div>
      <ScheduleEditorDrawer
        open={editorOpen}
        mode={editorMode}
        schedule={activeSchedule ?? undefined}
        defaultWorkflowId={editorMode === 'create' ? filters.workflowId : activeSchedule?.workflowId}
        workflowOptions={workflowOptions}
        onClose={() => setEditorOpen(false)}
        onSaved={handleScheduleSaved}
      />
    </TooltipProvider>
  )
}
