import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowStore } from '@/store/workflowStore';

export function useWorkflowExecution(workflowId?: string | null) {
  const { metadata } = useWorkflowStore();
  // Preserve explicit null to allow callers (e.g. chat inspector) to bypass
  // workflow scoping when the selected run's workflow hasn't resolved yet.
  const targetWorkflowId = workflowId === undefined ? metadata.id : workflowId;

  const executionState = useExecutionStore();
  const activeWorkflowId =
    executionState.workflowId ?? executionState.runStatus?.workflowId ?? null;

  if (targetWorkflowId === null) {
    return {
      ...executionState,
      isCurrentExecution: executionState.runId !== null,
    };
  }

  const isCurrentExecution = activeWorkflowId === targetWorkflowId;

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
      stopExecution: executionState.stopExecution,
      reset: executionState.reset,
    };
  }

  return {
    ...executionState,
    isCurrentExecution: true,
  };
}
