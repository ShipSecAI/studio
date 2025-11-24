import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'

export function useWorkflowExecution(workflowId?: string | null) {
  const { metadata } = useWorkflowStore()
  const targetWorkflowId = workflowId ?? metadata.id
  
  const executionState = useExecutionStore()
  const activeWorkflowId = executionState.workflowId ?? executionState.runStatus?.workflowId ?? null
  const isCurrentExecution = activeWorkflowId === targetWorkflowId

  if (!isCurrentExecution) {
    return {
      ...executionState,
      status: 'idle' as const,
      runStatus: null,
      logs: [],
      nodeStates: {},
      isCurrentExecution: false,
      // Keep actions available so we can start new runs
      startExecution: executionState.startExecution,
      reset: executionState.reset,
    }
  }

  return {
    ...executionState,
    isCurrentExecution: true,
  }
}
