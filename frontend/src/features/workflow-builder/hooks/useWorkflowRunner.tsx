import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { Node as ReactFlowNode } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'
import { useExecutionStore } from '@/store/executionStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { api } from '@/services/api'
import { track, Events } from '@/features/analytics/events'

type ToastFn = (params: {
  title: string
  description?: ReactNode
  variant?: 'default' | 'destructive' | 'warning' | 'success'
  duration?: number
}) => void

type WorkflowMetadataShape = {
  id: string | null
  name: string
  description: string
  currentVersionId: string | null
  currentVersion: number | null
}

interface UseWorkflowRunnerOptions {
  canManageWorkflows: boolean
  metadata: WorkflowMetadataShape
  isDirty: boolean
  isNewWorkflow: boolean
  nodes: ReactFlowNode<FrontendNodeData>[]
  setNodes: Dispatch<SetStateAction<ReactFlowNode<FrontendNodeData>[]>>
  toast: ToastFn
  resolveRuntimeInputDefinitions: () => any[]
  fetchRuns: (params: { workflowId: string; force?: boolean }) => Promise<unknown>
  markClean: () => void
  navigate: (path: string, options?: { replace?: boolean }) => void
  mostRecentRunId: string | null
  setIsLoading: (value: boolean) => void
  workflowRoutePrefix?: string
}

interface UseWorkflowRunnerResult {
  runDialogOpen: boolean
  setRunDialogOpen: (open: boolean) => void
  runtimeInputs: any[]
  prefilledRuntimeValues: Record<string, unknown>
  pendingVersionId: string | null
  handleRun: () => Promise<void>
  handleRerunFromTimeline: (runId: string) => void
  executeWorkflow: (options?: { inputs?: Record<string, unknown>; versionId?: string | null; version?: number }) => Promise<void>
}

export function useWorkflowRunner({
  canManageWorkflows,
  metadata,
  isDirty,
  isNewWorkflow,
  nodes,
  setNodes,
  toast,
  resolveRuntimeInputDefinitions,
  fetchRuns,
  markClean,
  navigate,
  mostRecentRunId,
  setIsLoading,
  workflowRoutePrefix = '/workflows',
}: UseWorkflowRunnerOptions): UseWorkflowRunnerResult {
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runtimeInputs, setRuntimeInputs] = useState<any[]>([])
  const [prefilledRuntimeValues, setPrefilledRuntimeValues] = useState<Record<string, unknown>>({})
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null)

  const executeWorkflow = useCallback(
    async (options?: { inputs?: Record<string, unknown>; versionId?: string | null; version?: number }) => {
      if (!canManageWorkflows) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can run workflows.',
        })
        return
      }

      const workflowId = metadata.id
      if (!workflowId) return

      if (isDirty) {
        toast({
          variant: 'warning',
          title: 'Save changes before running',
          description: 'Unsaved edits stay in the builder. Save to create a new version before executing.',
        })
        return
      }

      try {
        const shouldCommitBeforeRun = !options?.versionId && !metadata.currentVersionId

        if (shouldCommitBeforeRun) {
          await api.workflows.commit(workflowId)
          markClean()
        }

        const runId = await useExecutionStore.getState().startExecution(workflowId, {
          inputs: options?.inputs,
          versionId: options?.versionId ?? pendingVersionId ?? undefined,
          version: options?.version,
        })

        if (runId) {
          track(Events.WorkflowRunStarted, {
            workflow_id: workflowId,
            run_id: runId,
            node_count: nodes.length,
          })
          await fetchRuns({ workflowId, force: true }).catch(() => undefined)
          useExecutionTimelineStore.setState({
            selectedRunId: runId,
            playbackMode: 'live',
            isLiveFollowing: true,
            isPlaying: false,
          })
          // Navigate to run URL - this triggers mode update via useLayoutEffect
          navigate(`${workflowRoutePrefix}/${workflowId}/runs/${runId}`, { replace: true })
          toast({
            variant: 'success',
            title: 'Workflow started',
            description: `Execution ID: ${runId}. Check the review tab for live status.`,
          })
        } else {
          toast({
            variant: 'warning',
            title: 'Workflow started',
            description: 'Execution initiated, but no run ID was returned.',
          })
        }
      } catch (error) {
        handleExecutionError(error, toast, nodes, setNodes)
      } finally {
        setPendingVersionId(null)
        setPrefilledRuntimeValues({})
      }
    },
    [
      canManageWorkflows,
      metadata.id,
      metadata.currentVersionId,
      nodes,
      isDirty,
      pendingVersionId,
      fetchRuns,
      markClean,
      navigate,
      toast,
      setNodes,
      workflowRoutePrefix,
    ],
  )

  const handleRun = useCallback(async () => {
    if (!canManageWorkflows) {
      toast({
        variant: 'destructive',
        title: 'Insufficient permissions',
        description: 'Only administrators can run workflows.',
      })
      return
    }

    if (nodes.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot run workflow',
        description: 'Add components to the canvas before running the workflow.',
      })
      return
    }

    const workflowId = metadata.id
    if (!workflowId || isNewWorkflow) {
      toast({
        variant: 'warning',
        title: 'Save workflow to run',
        description: 'Save the workflow before starting an execution.',
      })
      return
    }

    const runtimeDefinitions = resolveRuntimeInputDefinitions()
    if (runtimeDefinitions.length > 0) {
      setRuntimeInputs(runtimeDefinitions)
      setPrefilledRuntimeValues({})
      setPendingVersionId(null)
      setRunDialogOpen(true)
      return
    }

    await executeWorkflow()
  }, [
    canManageWorkflows,
    executeWorkflow,
    isNewWorkflow,
    metadata.id,
    nodes.length,
    resolveRuntimeInputDefinitions,
    toast,
  ])

  const handleRerun = useCallback(
    async (targetRunId?: string | null) => {
      if (!canManageWorkflows) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can run workflows.',
        })
        return
      }

      const workflowId = metadata.id
      if (!workflowId) {
        toast({
          variant: 'destructive',
          title: 'Cannot rerun workflow',
          description: 'Workflow is not ready yet.',
        })
        return
      }

      let deferredToDialog = false
      try {
        setIsLoading(true)
        const selectedRunId = targetRunId ?? mostRecentRunId
        if (!selectedRunId) {
          toast({
            variant: 'destructive',
            title: 'No runs available',
            description: 'Run the workflow at least once before rerunning.',
          })
          return
        }

        const config = await api.executions.getConfig(selectedRunId)
        if (!config || config.workflowId !== workflowId) {
          toast({
            variant: 'destructive',
            title: 'Cannot rerun workflow',
            description: 'The selected run belongs to a different workflow.',
          })
          return
        }

        if (
          config.workflowVersionId &&
          metadata.currentVersionId &&
          config.workflowVersionId !== metadata.currentVersionId
        ) {
          toast({
            title: 'Replaying archived version',
            description: `Original run used workflow version v${config.workflowVersion ?? 'unknown'}.`,
          })
        }

        const runtimeDefinitions = resolveRuntimeInputDefinitions()
        if (runtimeDefinitions.length > 0) {
          deferredToDialog = true
          setIsLoading(false)
          setRuntimeInputs(runtimeDefinitions)
          setPrefilledRuntimeValues(config.inputs ?? {})
          setPendingVersionId(config.workflowVersionId ?? null)
          setRunDialogOpen(true)
          return
        }

        setIsLoading(false)
        await executeWorkflow({
          inputs: config.inputs ?? {},
          versionId: config.workflowVersionId ?? null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        toast({
          variant: 'destructive',
          title: 'Failed to rerun workflow',
          description: message,
        })
      } finally {
        if (!deferredToDialog) {
          setIsLoading(false)
        }
      }
    },
    [
      canManageWorkflows,
      executeWorkflow,
      metadata.currentVersionId,
      metadata.id,
      mostRecentRunId,
      resolveRuntimeInputDefinitions,
      setIsLoading,
      toast,
    ],
  )

  const handleRerunFromTimeline = useCallback(
    (runId: string) => {
      void handleRerun(runId)
    },
    [handleRerun],
  )

  useEffect(() => {
    if (!runDialogOpen) {
      setPrefilledRuntimeValues({})
      setPendingVersionId(null)
    }
  }, [runDialogOpen])

  return {
    runDialogOpen,
    setRunDialogOpen,
    runtimeInputs,
    prefilledRuntimeValues,
    pendingVersionId,
    handleRun,
    handleRerunFromTimeline,
    executeWorkflow,
  }
}

function handleExecutionError(
  error: unknown,
  toast: ToastFn,
  nodes: ReactFlowNode<FrontendNodeData>[],
  setNodes: Dispatch<SetStateAction<ReactFlowNode<FrontendNodeData>[]>>,
) {
  console.group('❌ Workflow Execution Failed')
  console.error('Error object:', error)
  if (error instanceof Error) {
    console.error('Message:', error.message)
    if (error.stack) console.error('Stack:', error.stack)
    if ((error as any).cause) console.error('Cause:', (error as any).cause)
  }
  console.groupEnd()

  let errorMessage = 'An unknown error occurred'
  let stackTrace: string | undefined

  if (error instanceof Error) {
    errorMessage = error.message
    stackTrace = error.stack
    const errorObj = error as any
    if (errorObj.response?.data?.message) {
      errorMessage = errorObj.response.data.message
      stackTrace = errorObj.response.data.stack || stackTrace
    }
  } else if (typeof error === 'string') {
    errorMessage = error
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String((error as any).message)
    if ('stack' in error) {
      stackTrace = String((error as any).stack)
    }
  }

  const formattedMessage = formatErrorMessage(errorMessage)
  const componentMatch = errorMessage.match(/\[([\w-]+)\]/)
  const failedComponentId = componentMatch ? componentMatch[1] : null

  if (failedComponentId && nodes.length > 0) {
    const failedNode = nodes.find((n) => n.id === failedComponentId)
    if (failedNode) {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          selected: node.id === failedComponentId,
          style: {
            ...node.style,
            ...(node.id === failedComponentId
              ? {
                outline: '3px solid #ef4444',
                outlineOffset: '2px',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }
              : {}),
          },
        })),
      )
    }
  }

  let helpMessage = '💡 Open browser console (F12) to see complete error details'
  if (errorMessage.includes('validation failed') || errorMessage.includes('required')) {
    helpMessage = '💡 Check the highlighted component configuration and ensure all required fields are filled'
  } else if (errorMessage.includes('not registered')) {
    helpMessage = '💡 This component may not be properly installed or registered'
  } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    helpMessage = '💡 The operation took too long. Try increasing timeout or check external service availability'
  }

  toast({
    variant: 'destructive',
    title: 'Workflow Execution Failed',
    duration: Infinity,
    description: (
      <div className="space-y-2 max-w-full">
        <div className="whitespace-pre-wrap break-words text-sm">{formattedMessage}</div>
        {stackTrace && (
          <details className="text-xs opacity-80">
            <summary className="cursor-pointer hover:opacity-100 font-medium">Stack Trace</summary>
            <pre className="mt-2 p-2 bg-black/20 rounded text-[10px] whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {stackTrace}
            </pre>
          </details>
        )}
        <p className="text-xs opacity-70 mt-2 font-medium">{helpMessage}</p>
      </div>
    ),
  })
}

function formatErrorMessage(message: string): string {
  let formatted = message
    .replace(/^Error:\s*/i, '')
    .replace(/^ApplicationFailure:\s*/i, '')
    .replace(/^WorkflowFailure:\s*/i, '')

  if (formatted.includes('[') && formatted.includes(']')) {
    const parts = formatted.split(';').map((part) => part.trim())
    if (parts.length > 1) {
      formatted = parts.map((part) => `• ${part}`).join('\n')
    }
  }

  return formatted
}
