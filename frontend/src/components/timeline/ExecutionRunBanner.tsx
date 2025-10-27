import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { cn } from '@/lib/utils'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  queued: 'default',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
  terminated: 'destructive',
  timed_out: 'destructive',
}

const formatDuration = (duration?: number) => {
  if (!duration || duration <= 0) return '—'
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  const minutes = Math.floor(duration / 60000)
  const seconds = Math.round((duration % 60000) / 1000)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function ExecutionRunBanner() {
  const {
    selectedRunId,
    availableRuns,
    playbackMode,
    isPlaying,
  } = useExecutionTimelineStore()
  const { mode } = useWorkflowUiStore()
  const { metadata } = useWorkflowStore()

  const selectedRun = useMemo(() => (
    availableRuns.find(run => run.id === selectedRunId)
  ), [availableRuns, selectedRunId])

  if (mode !== 'execution') {
    return null
  }

  if (!selectedRun) {
    return null
  }

  if (!metadata.id) {
    return null
  }

  if (selectedRun.workflowId && selectedRun.workflowId !== metadata.id) {
    return null
  }

  const statusVariant = STATUS_VARIANT[selectedRun.status.toLowerCase()] ?? 'secondary'
  const durationLabel = formatDuration(selectedRun.duration)
  const liveLabel = playbackMode === 'live'
  const runVersion = selectedRun.workflowVersion
  const currentVersion = metadata.currentVersion
  const hasVersionMetadata = typeof runVersion === 'number'
  const versionMismatch = hasVersionMetadata && typeof currentVersion === 'number' && runVersion !== currentVersion

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2',
        'rounded-full border bg-background/90 shadow-lg backdrop-blur px-5 py-2 flex items-center gap-4'
      )}
    >
      <div className="flex items-center gap-2 pointer-events-auto">
        <span className="text-sm font-semibold truncate max-w-[220px]">
          {selectedRun.workflowName}
        </span>
        <Badge variant={statusVariant} className="text-[10px] uppercase tracking-wide">
          {selectedRun.status.replace('_', ' ')}
        </Badge>
        {hasVersionMetadata && (
          <Badge
            variant={versionMismatch ? 'destructive' : 'secondary'}
            className="text-[10px] uppercase tracking-wide"
          >
            v{runVersion}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground pointer-events-auto">
        <span>Run #{selectedRun.id.slice(-6)}</span>
        <span>{durationLabel}</span>
        <span>{selectedRun.eventCount} events</span>
        {selectedRun.nodeCount > 0 && <span>{selectedRun.nodeCount} nodes</span>}
        {hasVersionMetadata && (
          <span className={versionMismatch ? 'text-amber-500' : undefined}>
            {versionMismatch && typeof currentVersion === 'number'
              ? `Replaying v${runVersion} • Current v${currentVersion}`
              : `Version v${runVersion}`}
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', liveLabel ? 'bg-red-500 animate-pulse' : 'bg-blue-500')} />
          {liveLabel ? (isPlaying ? 'Live • following' : 'Live • paused') : 'Execution mode'}
        </span>
      </div>
    </div>
  )
}
