import type { ExecutionStatus } from '@/schemas/execution'
import type { ExecutionRun } from '@/store/runStore'

export const TERMINAL_RUN_STATUSES: ExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']

export const normalizeRunSummary = (run: any): ExecutionRun => {
  const status = (typeof run.status === 'string' ? run.status.toUpperCase() : 'FAILED') as ExecutionStatus
  const startTime = typeof run.startTime === 'string' ? run.startTime : new Date().toISOString()
  const endTime = typeof run.endTime === 'string' ? run.endTime : undefined

  return {
    id: String(run.id ?? run.runId ?? ''),
    workflowId: String(run.workflowId ?? ''),
    workflowName: String(run.workflowName ?? 'Untitled workflow'),
    status,
    startTime,
    endTime,
    duration: typeof run.duration === 'number' ? run.duration : undefined,
    nodeCount: typeof run.nodeCount === 'number' ? run.nodeCount : 0,
    eventCount: typeof run.eventCount === 'number' ? run.eventCount : 0,
    createdAt: startTime,
    isLive: !TERMINAL_RUN_STATUSES.includes(status),
    workflowVersionId: typeof run.workflowVersionId === 'string' ? run.workflowVersionId : null,
    workflowVersion: typeof run.workflowVersion === 'number' ? run.workflowVersion : null,
    triggerType: (run.triggerType ?? 'manual') as ExecutionRun['triggerType'],
    triggerSource: typeof run.triggerSource === 'string' ? run.triggerSource : null,
    triggerLabel: typeof run.triggerLabel === 'string' ? run.triggerLabel : null,
    inputPreview:
      run.inputPreview ?? {
        runtimeInputs: {},
        nodeOverrides: {},
      },
  }
}

export const isRunLive = (run?: ExecutionRun | null) => {
  if (!run) {
    return false
  }
  if (run.isLive) {
    return true
  }
  return !TERMINAL_RUN_STATUSES.includes(run.status)
}
