import { Badge } from '@/components/ui/badge'
import { formatDuration, formatStartTime } from '@/utils/timeFormat'
import { getTriggerDisplay } from '@/utils/triggerDisplay'
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles'
import type { ExecutionRun } from '@/store/runStore'
import { cn } from '@/lib/utils'
import { Wifi } from 'lucide-react'

interface RunInfoDisplayProps {
  run: ExecutionRun
  currentWorkflowVersion?: number | null
  showBadges?: boolean
  className?: string
}

/**
 * Shared component for displaying run information
 * Used in both RunSelector dropdown and ExecutionInspector info-bar
 */
export function RunInfoDisplay({
  run,
  currentWorkflowVersion,
  showBadges = true,
  className,
}: RunInfoDisplayProps) {
  const triggerDisplay = getTriggerDisplay(run.triggerType, run.triggerLabel)
  const runVersion = typeof run.workflowVersion === 'number' ? run.workflowVersion : null
  const hasVersion = runVersion !== null
  const isOlderVersion =
    hasVersion && typeof currentWorkflowVersion === 'number' && runVersion !== currentWorkflowVersion

  const isRunLive = (run: ExecutionRun) => {
    const TERMINAL_STATUSES: ExecutionRun['status'][] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']
    if (run.isLive) return true
    return !TERMINAL_STATUSES.includes(run.status)
  }

  const infoItems = [
    formatStartTime(run.startTime),
    `${run.eventCount} events`,
    run.duration ? formatDuration(run.duration) : undefined,
  ].filter((item): item is string => item !== undefined)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {infoItems.map((item, index) => (
          <span key={`${run.id}-${item}`} className="flex items-center gap-2">
            {index > 0 && <span className="text-muted-foreground/50">•</span>}
            <span>{item}</span>
          </span>
        ))}
      </div>
      {showBadges && (
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-2">
            {hasVersion && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] uppercase tracking-wide',
                  isOlderVersion
                    ? '!border-amber-300 !bg-amber-50 !text-amber-700 dark:!bg-amber-900 dark:!text-amber-100 dark:!border-amber-500'
                    : '!bg-muted/50 !text-muted-foreground !border-border',
                )}
              >
                v{runVersion}
              </Badge>
            )}
            <Badge variant={triggerDisplay.variant} className="text-[10px] gap-1 max-w-[160px] truncate">
              <span aria-hidden="true">{triggerDisplay.icon}</span>
              <span className="truncate">{triggerDisplay.label}</span>
            </Badge>
            {isRunLive(run) && (
              <Badge variant="outline" className="text-[10px] gap-1 animate-pulse !bg-blue-50 !text-blue-700 !border-blue-300 dark:!bg-blue-900 dark:!text-blue-100 dark:!border-blue-500">
                <Wifi className="h-3 w-3" />
                Live
              </Badge>
            )}
          </div>
          <Badge
            variant="outline"
            className={getStatusBadgeClassFromStatus(run.status, 'text-[11px]')}
          >
            {run.status}
          </Badge>
        </div>
      )}
    </div>
  )
}

