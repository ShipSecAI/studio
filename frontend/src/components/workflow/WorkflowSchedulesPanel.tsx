import { useCallback, useState } from 'react'
import { Loader2, Plus, ExternalLink, X, Pause, Play, Zap, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { WorkflowSchedule } from '@shipsec/shared'

export const formatScheduleTimestamp = (value?: string | null) => {
  if (!value) return 'Not scheduled'
  try {
    const date = new Date(value)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(date)
  } catch {
    return value
  }
}

export const scheduleStatusVariant: Record<
  WorkflowSchedule['status'],
  'default' | 'secondary' | 'destructive'
> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
}

export interface WorkflowSchedulesSummaryBarProps {
  schedules: WorkflowSchedule[]
  isLoading: boolean
  error?: string | null
  onCreate: () => void
  onExpand: () => void
  onViewAll: () => void
}

export function WorkflowSchedulesSummaryBar({
  schedules,
  isLoading,
  error,
  onCreate,
  onExpand,
  onViewAll,
}: WorkflowSchedulesSummaryBarProps) {
  const countActive = schedules.filter((s) => s.status === 'active').length
  const countPaused = schedules.filter((s) => s.status === 'paused').length
  const countError = schedules.filter((s) => s.status === 'error').length

  return (
    <div className="pointer-events-auto flex items-center gap-2 md:gap-3 rounded-xl border bg-background/95 px-2 md:px-4 py-1.5 md:py-2 ring-1 ring-border/60 shadow-lg">
      <div className="flex items-center gap-2 md:gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="space-y-0 hidden sm:block">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Schedules
          </div>
          <div className="text-[11px] text-muted-foreground">
            {isLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </span>
            ) : error ? (
              <span className="text-destructive">{error}</span>
            ) : schedules.length === 0 ? (
              <span>No schedules</span>
            ) : (
              <>
                {countActive > 0 && <span>{countActive} active</span>}
                {countPaused > 0 && <span className="ml-2">{countPaused} paused</span>}
                {countError > 0 && (
                  <span className="ml-2 text-destructive">{countError} error</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <Button type="button" size="sm" className="h-7 md:h-8 px-2 md:px-3 text-xs" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5 md:mr-1" />
          <span className="hidden md:inline">New</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 md:h-8 px-2 md:px-3 text-xs"
          onClick={onExpand}
        >
          Manage
        </Button>
        <div className="relative group hidden md:block">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Go to schedule manager"
            aria-label="Go to schedule manager"
            onClick={onViewAll}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <div className="pointer-events-none absolute -bottom-8 right-0 whitespace-nowrap rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground opacity-0 transition group-hover:opacity-100">
            Go to schedule manager
          </div>
        </div>
      </div>
    </div>
  )
}

export interface WorkflowSchedulesSidebarProps {
  schedules: WorkflowSchedule[]
  isLoading: boolean
  error?: string | null
  onClose: () => void
  onCreate: () => void
  onManage: () => void
  onEdit: (schedule: WorkflowSchedule) => void
  onAction: (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => Promise<void> | void
  onDelete: (schedule: WorkflowSchedule) => Promise<void> | void
}

export function WorkflowSchedulesSidebar({
  schedules,
  isLoading,
  error,
  onClose,
  onCreate,
  onManage,
  onEdit,
  onAction,
  onDelete,
}: WorkflowSchedulesSidebarProps) {
  const [actionState, setActionState] = useState<Record<string, 'pause' | 'resume' | 'run'>>({})

  const handleAction = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      setActionState((state) => ({ ...state, [schedule.id]: action }))
      try {
        await onAction(schedule, action)
      } finally {
        setActionState((state) => {
          const next = { ...state }
          delete next[schedule.id]
          return next
        })
      }
    },
    [onAction],
  )

  return (
    <div className="flex h-full flex-col border-l bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">Schedules</h3>
          <Badge variant="outline" className="text-[11px] font-medium">
            {schedules.length}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New
          </Button>
          <Button size="sm" variant="outline" onClick={onManage}>
            View page
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading schedules…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : schedules.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No schedules yet. Create one to run this workflow automatically.
          </div>
        ) : (
          schedules.map((schedule) => {
            const isActive = schedule.status === 'active'
            const actionLabel = isActive ? 'Pause' : 'Resume'
            const actionKey = isActive ? 'pause' : 'resume'
            const pendingAction = actionState[schedule.id]
            return (
              <div key={schedule.id} className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{schedule.name}</span>
                      <Badge
                        variant={scheduleStatusVariant[schedule.status]}
                        className="text-[11px] capitalize"
                      >
                        {schedule.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Next: {formatScheduleTimestamp(schedule.nextRunAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={Boolean(pendingAction && pendingAction !== actionKey)}
                      onClick={() => handleAction(schedule, actionKey as 'pause' | 'resume')}
                      title={actionLabel}
                      aria-label={actionLabel}
                    >
                      {pendingAction === 'pause' || pendingAction === 'resume' ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : isActive ? (
                        <Pause className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <Play className="mr-1 h-3.5 w-3.5" />
                      )}
                      {actionLabel}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={Boolean(pendingAction && pendingAction !== 'run')}
                      onClick={() => handleAction(schedule, 'run')}
                      title="Run now"
                      aria-label="Run now"
                    >
                      {pendingAction === 'run' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => onEdit(schedule)}
                      title="Edit schedule"
                      aria-label="Edit schedule"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => onDelete(schedule)}
                      disabled={Boolean(pendingAction)}
                      title="Delete schedule"
                      aria-label="Delete schedule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {schedule.description && (
                  <p className="text-xs text-muted-foreground">{schedule.description}</p>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
