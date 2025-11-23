import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from 'reactflow'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Canvas } from '@/components/workflow/Canvas'
import { ExecutionInspector } from '@/components/timeline/ExecutionInspector'
import { RunWorkflowDialog } from '@/components/workflow/RunWorkflowDialog'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useComponentStore } from '@/store/componentStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useRunStore } from '@/store/runStore'
import { api, API_BASE_URL } from '@/services/api'
import { cn } from '@/lib/utils'
import {
  serializeWorkflowForCreate,
  serializeWorkflowForUpdate,
  deserializeNodes,
  deserializeEdges,
  serializeNodes,
  serializeEdges,
} from '@/utils/workflowSerializer'
import type { FrontendNodeData } from '@/schemas/node'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { WorkflowImportSchema, DEFAULT_WORKFLOW_VIEWPORT } from '@/schemas/workflow'
import { track, Events } from '@/features/analytics/events'

const cloneNodes = (nodes: ReactFlowNode<FrontendNodeData>[]) =>
  nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      parameters: node.data?.parameters ? { ...node.data.parameters } : {},
      config: node.data?.config ? { ...node.data.config } : {},
      inputs: node.data?.inputs ? { ...node.data.inputs } : {},
    },
  }))

const cloneEdges = (edges: ReactFlowEdge[]) => edges.map((edge) => ({ ...edge }))

/**
 * Format error messages to be more human-readable
 */
function formatErrorMessage(message: string): string {
  // Remove common technical prefixes
  let formatted = message
    .replace(/^Error:\s*/i, '')
    .replace(/^ApplicationFailure:\s*/i, '')
    .replace(/^WorkflowFailure:\s*/i, '')

  // Add bullet points for component failures
  if (formatted.includes('[') && formatted.includes(']')) {
    const parts = formatted.split(';').map((part) => part.trim())
    if (parts.length > 1) {
      formatted = parts.map((part) => `• ${part}`).join('\n')
    }
  }

  return formatted
}

function WorkflowBuilderContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNewWorkflow = id === 'new'
  const {
    metadata,
    isDirty,
    setMetadata,
    setWorkflowId,
    markClean,
    markDirty,
    resetWorkflow,
  } = useWorkflowStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<FrontendNodeData>([])
  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const { getComponent } = useComponentStore()
  const [isLoading, setIsLoading] = useState(false)
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runtimeInputs, setRuntimeInputs] = useState<any[]>([])
  const [prefilledRuntimeValues, setPrefilledRuntimeValues] = useState<Record<string, unknown>>({})
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null)
  const mode = useWorkflowUiStore((state) => state.mode)
  const libraryOpen = useWorkflowUiStore((state) => state.libraryOpen)
  const toggleLibrary = useWorkflowUiStore((state) => state.toggleLibrary)
  const inspectorWidth = useWorkflowUiStore((state) => state.inspectorWidth)
  const setInspectorWidth = useWorkflowUiStore((state) => state.setInspectorWidth)
  const setMode = useWorkflowUiStore((state) => state.setMode)
  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId)
  const fetchRuns = useRunStore((state) => state.fetchRuns)
  const workflowCacheKey = metadata.id ?? '__global__'
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs)
  const runs = scopedRuns ?? []
  const { toast } = useToast()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const inspectorResizingRef = useRef(false)
  const isLibraryVisible = libraryOpen && mode === 'design'
  const [showLibraryContent, setShowLibraryContent] = useState(isLibraryVisible)
  const [historicalVersionId, setHistoricalVersionId] = useState<string | null>(null)
  const historicalGraphRef = useRef<{
    nodes: ReactFlowNode<FrontendNodeData>[]
    edges: ReactFlowEdge[]
  } | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])
  const workflowRuns = useMemo(() => runs, [runs])
  const mostRecentRunId = useMemo(
    () => (workflowRuns.length > 0 ? workflowRuns[0].id : null),
    [workflowRuns],
  )
  // Ensure "New workflow" always opens in design mode
  useEffect(() => {
    if (isNewWorkflow) {
      setMode('design')
    }
  }, [isNewWorkflow, setMode])

  useEffect(() => {
    if (!metadata.id) {
      useExecutionTimelineStore.getState().reset()
      return
    }

    fetchRuns({ workflowId: metadata.id }).catch(() => undefined)
  }, [fetchRuns, metadata.id])

  useEffect(() => {
    if (!metadata.id) {
      return
    }

    const run = workflowRuns.find((candidate) => candidate.id === selectedRunId)
    const versionId = run?.workflowVersionId ?? null

    if (!run || !versionId || versionId === metadata.currentVersionId) {
      if (historicalVersionId && historicalGraphRef.current) {
        setNodes(cloneNodes(historicalGraphRef.current.nodes))
        setEdges(cloneEdges(historicalGraphRef.current.edges))
        historicalGraphRef.current = null
      }
      setHistoricalVersionId(null)
      return
    }

    if (versionId === historicalVersionId) {
      return
    }

    let cancelled = false

    const previewHistoricalVersion = async () => {
      try {
        if (!historicalVersionId && !historicalGraphRef.current) {
          historicalGraphRef.current = {
            nodes: cloneNodes(nodesRef.current),
            edges: cloneEdges(edgesRef.current),
          }
        }

        const workflowIdForRun = run.workflowId ?? metadata.id
        if (!workflowIdForRun) {
          return
        }

        const version = await api.workflows.getVersion(workflowIdForRun, versionId)
        if (cancelled) return

        const versionNodes = deserializeNodes(version)
        const versionEdges = deserializeEdges(version)

        setNodes(versionNodes)
        setEdges(versionEdges)
        setHistoricalVersionId(versionId)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load workflow version:', error)
        toast({
          variant: 'destructive',
          title: 'Failed to load workflow version',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    previewHistoricalVersion()

    return () => {
      cancelled = true
    }
  }, [
    metadata.id,
    metadata.currentVersionId,
    workflowRuns,
    selectedRunId,
    historicalVersionId,
    setNodes,
    setEdges,
    toast,
  ])

  useEffect(() => {
    if (!runDialogOpen) {
      setPrefilledRuntimeValues({})
      setPendingVersionId(null)
    }
  }, [runDialogOpen])
  // Load workflow on mount (if not new)
  useEffect(() => {
    const loadWorkflow = async () => {
      if (isNewWorkflow) {
        // Reset store for new workflow
        resetWorkflow()
        setNodes([])
        setEdges([])
        historicalGraphRef.current = null
        setHistoricalVersionId(null)
        track(Events.WorkflowBuilderLoaded, { is_new: true })
        return
      }

      if (!id) return

      setIsLoading(true)
      try {
        const workflow = await api.workflows.get(id)

        // Update workflow store
        setMetadata({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description ?? '',
          currentVersionId: workflow.currentVersionId ?? null,
          currentVersion: workflow.currentVersion ?? null,
        })

        // Deserialize and set nodes/edges
        const workflowEdges = deserializeEdges(workflow)
        const workflowNodes = deserializeNodes(workflow)

        setNodes(workflowNodes)
        setEdges(workflowEdges)
        historicalGraphRef.current = {
          nodes: cloneNodes(workflowNodes),
          edges: cloneEdges(workflowEdges),
        }
        setHistoricalVersionId(null)

        // Mark as clean (no unsaved changes)
        markClean()

        // Analytics: builder loaded (existing workflow)
        track(Events.WorkflowBuilderLoaded, {
          workflow_id: workflow.id,
          is_new: false,
          node_count: workflowNodes.length,
        })
      } catch (error) {
        console.error('Failed to load workflow:', error)

        // Check if it's a network error (backend not available)
        const isNetworkError = error instanceof Error &&
          (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

        if (isNetworkError) {
          toast({
            variant: 'destructive',
            title: 'Cannot connect to backend',
            description: `Ensure the backend is running at ${API_BASE_URL}.`,
          })
        } else {
          toast({
            variant: 'destructive',
            title: 'Failed to load workflow',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }

        navigate('/')
      } finally {
        setIsLoading(false)
      }
    }

    loadWorkflow()
  }, [id, isNewWorkflow, navigate, setMetadata, setNodes, setEdges, resetWorkflow, markClean])

  const resolveRuntimeInputDefinitions = useCallback(() => {
    const triggerNode = nodes.find(node => {
      const nodeData = node.data as any
      const componentRef = nodeData.componentId ?? nodeData.componentSlug
      const component = getComponent(componentRef)
      return component?.slug === 'manual-trigger'
    })

    if (!triggerNode) {
      return []
    }

    const nodeData = triggerNode.data as any
    const runtimeInputsParam = nodeData.parameters?.runtimeInputs

    if (!runtimeInputsParam) {
      return []
    }

    try {
      const parsedInputs = typeof runtimeInputsParam === 'string'
        ? JSON.parse(runtimeInputsParam)
        : runtimeInputsParam

      if (Array.isArray(parsedInputs) && parsedInputs.length > 0) {
        return parsedInputs.map((input: any) => ({
          ...input,
          type: input.type === 'string' ? 'text' : input.type,
        }))
      }
    } catch (error) {
      console.error('Failed to parse runtime inputs:', error)
    }

    return []
  }, [getComponent, nodes])

  const executeWorkflow = async (options?: {
    inputs?: Record<string, unknown>
    versionId?: string | null
    version?: number
  }) => {
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

    // Don't set isLoading - that's only for initial workflow load
    // Running a workflow shouldn't show the "Loading workflow..." screen
    try {
      const shouldCommitBeforeRun =
        !options?.versionId &&
        (isDirty || !metadata.currentVersionId)

      if (shouldCommitBeforeRun) {
        // Commit workflow - this creates a new version
        // We don't need to reload the workflow, just mark as clean
        // The currentVersionId will be updated when workflow is next loaded
        await api.workflows.commit(workflowId)
        markClean()
      }

      const runId = await useExecutionStore.getState().startExecution(
        workflowId,
        {
          inputs: options?.inputs,
          versionId: options?.versionId ?? pendingVersionId ?? undefined,
          version: options?.version,
        }
      )

      if (runId) {
        track(Events.WorkflowRunStarted, {
          workflow_id: workflowId,
          run_id: runId,
          node_count: nodes.length,
        })
        // Don't force mode change - inspector will appear automatically when run is selected
        // This prevents full UI re-render and allows smooth transition
        await fetchRuns({ workflowId, force: true }).catch(() => undefined)
        useExecutionTimelineStore.setState({ 
          selectedRunId: runId,
          playbackMode: 'live',
          isLiveFollowing: true,
          isPlaying: false,
        })
        // Optionally switch to execution mode smoothly (user can still switch back)
        // Only switch if we're in design mode to avoid jarring transitions
        if (mode === 'design') {
          // Use setTimeout to allow state updates to settle first
          setTimeout(() => setMode('execution'), 0)
        }
        // Timeline will be populated by live updates from execution store subscription
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
      // Log full error details to console for debugging
      console.group('❌ Workflow Execution Failed')
      console.error('Error object:', error)
      if (error instanceof Error) {
        console.error('Message:', error.message)
        if (error.stack) console.error('Stack:', error.stack)
        if ((error as any).cause) console.error('Cause:', (error as any).cause)
      }
      console.groupEnd()

      // Extract error message and stack trace
      let errorMessage = 'An unknown error occurred'
      let stackTrace: string | undefined

      if (error instanceof Error) {
        errorMessage = error.message
        stackTrace = error.stack

        // Check if it's a structured API error
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

      // Format the error message for better readability
      const formattedMessage = formatErrorMessage(errorMessage)

      // Extract component ID from error message for highlighting
      const componentMatch = errorMessage.match(/\[([\w-]+)\]/)
      const failedComponentId = componentMatch ? componentMatch[1] : null

      // Highlight the failed component if we found it
      if (failedComponentId && nodes.length > 0) {
        const failedNode = nodes.find((n) => n.id === failedComponentId)
        if (failedNode) {
          // Update nodes to highlight the failed one
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
            }))
          )
        }
      }

      // Determine helpful message based on error type
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
        duration: Infinity, // Don't auto-close error toasts
        description: (
          <div className="space-y-2 max-w-full">
            <div className="whitespace-pre-wrap break-words text-sm">
              {formattedMessage}
            </div>

            {stackTrace && (
              <details className="text-xs opacity-80">
                <summary className="cursor-pointer hover:opacity-100 font-medium">
                  Stack Trace
                </summary>
                <pre className="mt-2 p-2 bg-black/20 rounded text-[10px] whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {stackTrace}
                </pre>
              </details>
            )}

            <p className="text-xs opacity-70 mt-2 font-medium">
              {helpMessage}
            </p>
          </div>
        ),
      })
    } finally {
      // Don't reset isLoading here - it wasn't set
      setPendingVersionId(null)
      setPrefilledRuntimeValues({})
    }
  }

  const handleRun = async () => {
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

    // Ensure workflow is saved before running
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

    // No runtime inputs needed, run directly
    await executeWorkflow()
  }

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
      toast,
    ],
  )

  const handleRerunFromTimeline = useCallback(
    (runId: string) => {
      void handleRerun(runId)
    },
    [handleRerun],
  )

  const handleImportWorkflow = useCallback(
    async (file: File) => {
      if (!canManageWorkflows) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can import workflows.',
        })
        return
      }

      const contents = await file.text()
      const parsed = WorkflowImportSchema.parse(JSON.parse(contents))

      const graph = 'graph' in parsed
        ? {
            nodes: parsed.graph.nodes ?? [],
            edges: parsed.graph.edges ?? [],
            viewport: parsed.graph.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
          }
        : {
            nodes: parsed.nodes ?? [],
            edges: parsed.edges ?? [],
            viewport: parsed.viewport ?? DEFAULT_WORKFLOW_VIEWPORT,
          }

      const workflowGraph = {
        graph: {
          nodes: graph.nodes,
          edges: graph.edges,
          viewport: graph.viewport,
        },
      }

      const normalizedNodes = deserializeNodes(workflowGraph)
      const normalizedEdges = deserializeEdges(workflowGraph)

      resetWorkflow()
      setNodes(normalizedNodes)
      setEdges(normalizedEdges)
      setMetadata({
        id: null,
        name: parsed.name,
        description: parsed.description ?? '',
        currentVersion: null,
        currentVersionId: null,
      })
      markDirty()
      setMode('design')

      toast({
        variant: 'success',
        title: 'Workflow imported',
        description: `Loaded ${parsed.name}`,
      })
    },
    [
      canManageWorkflows,
      markDirty,
      resetWorkflow,
      setEdges,
      setMetadata,
      setMode,
      setNodes,
      toast,
    ]
  )

  const handleExportWorkflow = useCallback(() => {
    if (!canManageWorkflows) {
      toast({
        variant: 'destructive',
        title: 'Insufficient permissions',
        description: 'Only administrators can export workflows.',
      })
      return
    }

    if (nodes.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot export workflow',
        description: 'Add at least one component before exporting.',
      })
      return
    }

    try {
      if (typeof window === 'undefined') {
        throw new Error('Export is only available in a browser environment.')
      }

      const exportedNodes = serializeNodes(nodes)
      const exportedEdges = serializeEdges(edges)

      const payload = {
        name: metadata.name || 'Untitled Workflow',
        description: metadata.description || '',
        graph: {
          nodes: exportedNodes,
          edges: exportedEdges,
          viewport: DEFAULT_WORKFLOW_VIEWPORT,
        },
        metadata: {
          workflowId: metadata.id ?? null,
          currentVersionId: metadata.currentVersionId ?? null,
          currentVersion: metadata.currentVersion ?? null,
          exportedAt: new Date().toISOString(),
        },
      }

      const fileContents = JSON.stringify(payload, null, 2)
      const blob = new Blob([fileContents], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const safeName = (metadata.name || 'workflow')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'workflow'

      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast({
        variant: 'success',
        title: 'Workflow exported',
        description: `${safeName}.json saved to your device.`,
      })
    } catch (error) {
      console.error('Failed to export workflow:', error)
      toast({
        variant: 'destructive',
        title: 'Failed to export workflow',
        description: error instanceof Error ? error.message : 'Unknown error occurred.',
      })
    }
  }, [canManageWorkflows, edges, metadata, nodes, toast])

  const handleSave = async () => {
    if (!canManageWorkflows) {
      toast({
        variant: 'destructive',
        title: 'Insufficient permissions',
        description: 'Only administrators can save workflow changes.',
      })
      return
    }

    try {
      // Defensive check for undefined nodes/edges
      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot save workflow',
          description: 'Add at least one component before saving.',
        })
        return
      }

      if (!edges || !Array.isArray(edges)) {
        toast({
          variant: 'destructive',
          title: 'Cannot save workflow',
          description: 'Invalid workflow edges data.',
        })
        return
      }

      // Determine if this is a create or update operation
      const workflowId = metadata.id

      if (!workflowId || isNewWorkflow) {
        // Create new workflow
        const payload = serializeWorkflowForCreate(
          metadata.name,
          metadata.description || undefined,
          nodes,
          edges
        )

        const savedWorkflow = await api.workflows.create(payload)

        // Update store with new workflow ID
        setWorkflowId(savedWorkflow.id)
        setMetadata({
          id: savedWorkflow.id,
          name: savedWorkflow.name,
          description: savedWorkflow.description ?? '',
          currentVersionId: savedWorkflow.currentVersionId ?? null,
          currentVersion: savedWorkflow.currentVersion ?? null,
        })
        markClean()

        // Navigate to the new workflow URL
        navigate(`/workflows/${savedWorkflow.id}`, { replace: true })

        // Analytics: workflow created
        track(Events.WorkflowCreated, {
          workflow_id: savedWorkflow.id,
          node_count: nodes.length,
          edge_count: edges.length,
        })

        toast({
          variant: 'success',
          title: 'Workflow created',
          description: 'Your workflow has been saved and is ready to run.',
        })
      } else {
        // Update existing workflow
        const payload = serializeWorkflowForUpdate(
          workflowId,
          metadata.name,
          metadata.description || undefined,
          nodes,
          edges
        )

        const updatedWorkflow = await api.workflows.update(workflowId, payload)
        setMetadata({
          id: updatedWorkflow.id,
          name: updatedWorkflow.name,
          description: updatedWorkflow.description ?? '',
          currentVersionId: updatedWorkflow.currentVersionId ?? null,
          currentVersion: updatedWorkflow.currentVersion ?? null,
        })
        markClean()

        // Analytics: workflow saved
        track(Events.WorkflowSaved, {
          workflow_id: updatedWorkflow.id,
          node_count: nodes.length,
          edge_count: edges.length,
        })

        toast({
          variant: 'success',
          title: 'Workflow saved',
          description: 'All changes have been saved.',
        })
      }
    } catch (error) {
      console.error('Failed to save workflow:', error)

      // Check if it's a network error (backend not available)
      const isNetworkError = error instanceof Error &&
        (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

      if (isNetworkError) {
        toast({
          variant: 'destructive',
          title: 'Cannot connect to backend',
          description: `Ensure the backend is running at ${API_BASE_URL}. Your workflow remains available locally.`,
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'Failed to save workflow',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  const handleInspectorResizeStart = useCallback((event: React.MouseEvent) => {
    if (mode !== 'execution') {
      return
    }
    inspectorResizingRef.current = true
    document.body.classList.add('select-none')
    event.preventDefault()
  }, [mode])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!inspectorResizingRef.current || mode !== 'execution') {
        return
      }
      const container = layoutRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const newWidth = rect.right - event.clientX
      setInspectorWidth(newWidth)
    }

    const stopResizing = () => {
      if (inspectorResizingRef.current) {
        inspectorResizingRef.current = false
        document.body.classList.remove('select-none')
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [mode, setInspectorWidth])

  // Show inspector if there's an active run OR if mode is execution
  // This allows smooth transition without forcing mode change
  const isInspectorVisible = mode === 'execution' || (selectedRunId !== null && mode !== 'design')
  // Delay rendering sidebar contents until the expand animation completes to avoid mid-transition layout shifts.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (isLibraryVisible) {
      timeoutId = setTimeout(() => setShowLibraryContent(true), 220)
    } else {
      setShowLibraryContent(false)
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [isLibraryVisible])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar
        workflowId={id}
        isNew={isNewWorkflow}
        onRun={handleRun}
        onSave={handleSave}
        onImport={handleImportWorkflow}
        onExport={handleExportWorkflow}
        canManageWorkflows={canManageWorkflows}
      />
      {mode === 'design' && (
        <Button
          type="button"
          variant="secondary"
          onClick={toggleLibrary}
          className={cn(
            'fixed z-50 flex items-center gap-2 rounded-full border bg-background/95 text-xs font-medium shadow-lg transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            isLibraryVisible
              ? 'top-[88px] left-[300px] md:left-[364px] h-10 w-10 justify-center'
              : 'top-[88px] left-5 md:left-[72px] h-10 px-4 py-2'
          )}
          aria-expanded={isLibraryVisible}
          aria-label={isLibraryVisible ? 'Hide component library' : 'Show component library'}
          title={isLibraryVisible ? 'Hide components' : 'Show components'}
        >
          {isLibraryVisible ? (
            <PanelLeftClose className="h-5 w-5 flex-shrink-0" />
          ) : (
            <PanelLeftOpen className="h-5 w-5 flex-shrink-0" />
          )}
          <span className={cn('font-medium whitespace-nowrap', isLibraryVisible ? 'hidden' : 'block')}>
            Show components
          </span>
        </Button>
      )}

      <div ref={layoutRef} className="flex flex-1 overflow-hidden">
        <aside
          className={cn(
            'relative h-full transition-[width] duration-200 ease-in-out bg-background',
            isLibraryVisible ? 'border-r w-[320px]' : 'border-r-0 w-0'
          )}
        >
          <div
            className={cn(
              'absolute inset-0 transition-opacity duration-150',
              showLibraryContent ? 'opacity-100' : 'opacity-0 pointer-events-none select-none'
            )}
          >
            <Sidebar />
          </div>
        </aside>

        <main className="flex-1 relative flex">
          <Canvas
            className="flex-1 h-full relative"
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          />
          {isInspectorVisible && (
            <aside
              className="relative h-full border-l bg-background"
              style={{ width: inspectorWidth }}
            >
              <div
                className="absolute top-0 left-0 h-full w-2 cursor-col-resize border-l border-transparent hover:border-primary/40"
                onMouseDown={handleInspectorResizeStart}
              />
              <div className="flex h-full min-h-0 pl-2 overflow-hidden">
                <ExecutionInspector onRerunRun={handleRerunFromTimeline} />
              </div>
            </aside>
          )}
        </main>
      </div>

      {/* Bottom panel removed in favor of contextual inspectors */}

      <RunWorkflowDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        runtimeInputs={runtimeInputs}
        initialValues={prefilledRuntimeValues}
        onRun={(inputs) => executeWorkflow({ inputs, versionId: pendingVersionId })}
      />
    </div>
  )
}

export function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent />
    </ReactFlowProvider>
  )
}
