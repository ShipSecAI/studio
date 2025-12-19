import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  ReactFlowProvider,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from 'reactflow'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { ExecutionInspector } from '@/components/timeline/ExecutionInspector'
import { RunWorkflowDialog } from '@/components/workflow/RunWorkflowDialog'
import { WorkflowBuilderShell } from '@/components/workflow/WorkflowBuilderShell'
import {
  useWorkflowGraphControllers,
  cloneNodes,
  cloneEdges,
  ENTRY_COMPONENT_ID,
  ENTRY_COMPONENT_SLUG,
} from '@/features/workflow-builder/hooks/useWorkflowGraphControllers'
import { WorkflowDesignerPane } from '@/features/workflow-builder/components/WorkflowDesignerPane'
import { WorkflowExecutionPane } from '@/features/workflow-builder/components/WorkflowExecutionPane'
import { useWorkflowImportExport } from '@/features/workflow-builder/hooks/useWorkflowImportExport'
import { useDesignWorkflowPersistence } from '@/features/workflow-builder/hooks/useDesignWorkflowPersistence'
import { useWorkflowRunner } from '@/features/workflow-builder/hooks/useWorkflowRunner'
import { useToast } from '@/components/ui/use-toast'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useComponentStore } from '@/store/componentStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowExecutionLifecycle } from '@/features/workflow-builder/hooks/useWorkflowExecutionLifecycle'
import { api, API_BASE_URL } from '@/services/api'
import {
  deserializeNodes,
  deserializeEdges,
  serializeNodes,
  serializeEdges,
} from '@/utils/workflowSerializer'
import type { FrontendNodeData } from '@/schemas/node'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { track, Events } from '@/features/analytics/events'

const ENTRY_DEFAULT_RUNTIME_INPUTS = [
  {
    id: 'input1',
    label: 'Input 1',
    type: 'array',
    required: true,
    description: '',
  },
] as const

const isEntryPointNode = (node?: ReactFlowNode<FrontendNodeData>) => {
  if (!node) return false
  const componentRef = node.data?.componentId ?? node.data?.componentSlug
  return componentRef === ENTRY_COMPONENT_ID || componentRef === ENTRY_COMPONENT_SLUG
}
const computeGraphSignature = (
  nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
  edgesSnapshot: ReactFlowEdge[] | null,
) => {
  const normalizedNodes = serializeNodes(nodesSnapshot ?? [])
    .map((node) => ({
      ...node,
      data: {
        ...node.data,
        config: node.data.config ?? {},
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const normalizedEdges = serializeEdges(edgesSnapshot ?? [])
    .sort((a, b) => a.id.localeCompare(b.id))

  return JSON.stringify({
    nodes: normalizedNodes,
    edges: normalizedEdges,
  })
}

function WorkflowBuilderContent() {
  const { id, runId: routeRunId } = useParams<{ id: string; runId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const builderRoutePrefix = '/workflows'
  const isNewWorkflow = id === 'new'
  // Detect if we're on a /runs URL (execution mode without specific run)
  const isRunsRoute = location.pathname.includes('/runs') && !routeRunId
  const {
    metadata,
    isDirty,
    setMetadata,
    setWorkflowId,
    markClean,
    markDirty,
    resetWorkflow,
  } = useWorkflowStore()
  const { toast } = useToast()

  const { design: designGraph, execution: executionGraph } = useWorkflowGraphControllers({
    toast,
    onDesignGraphDirty: markDirty,
  })

  const {
    nodes: designNodes,
    edges: designEdges,
    setNodes: setDesignNodes,
    setEdges: setDesignEdges,
    onNodesChange: onDesignNodesChangeBase,
    onEdgesChange: onDesignEdgesChangeBase,
    nodesRef: designNodesRef,
    edgesRef: designEdgesRef,
    preservedStateRef: preservedDesignStateRef,
    savedSnapshotRef: designSavedSnapshotRef,
  } = designGraph

  const {
    nodes: executionNodes,
    edges: executionEdges,
    setNodes: setExecutionNodes,
    setEdges: setExecutionEdges,
    onNodesChange: onExecutionNodesChangeBase,
    onEdgesChange: onExecutionEdgesChangeBase,
    nodesRef: executionNodesRef,
    edgesRef: executionEdgesRef,
    preservedStateRef: preservedExecutionStateRef,
    savedSnapshotRef: executionLoadedSnapshotRef,
  } = executionGraph

  // Execution dirty state: tracks if nodes have been rearranged in execution mode
  const [_executionDirty, setExecutionDirty] = useState(false)

  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const mode = useWorkflowUiStore((state) => state.mode)
  const libraryOpen = useWorkflowUiStore((state) => state.libraryOpen)
  const toggleLibrary = useWorkflowUiStore((state) => state.toggleLibrary)
  const inspectorWidth = useWorkflowUiStore((state) => state.inspectorWidth)
  const setInspectorWidth = useWorkflowUiStore((state) => state.setInspectorWidth)
  const setMode = useWorkflowUiStore((state) => state.setMode)
  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId)
  const showDemoComponents = useWorkflowUiStore((state) => state.showDemoComponents)
  const toggleDemoComponents = useWorkflowUiStore((state) => state.toggleDemoComponents)

  // Mode-aware getters for nodes and edges - memoized to prevent unnecessary re-renders
  const nodes = useMemo(() => {
    return mode === 'design' ? designNodes : executionNodes
  }, [mode, designNodes, executionNodes])

  const edges = useMemo(() => {
    return mode === 'design' ? designEdges : executionEdges
  }, [mode, designEdges, executionEdges])

  const setNodes = mode === 'design' ? setDesignNodes : setExecutionNodes
  const setEdges = mode === 'design' ? setDesignEdges : setExecutionEdges
  const onNodesChangeBase = mode === 'design' ? onDesignNodesChangeBase : onExecutionNodesChangeBase
  const onEdgesChangeBase = mode === 'design' ? onDesignEdgesChangeBase : onExecutionEdgesChangeBase
  const workflowId = metadata.id
  const workflowName = metadata.name || 'Untitled workflow'
  const { handleImportWorkflow, handleExportWorkflow } = useWorkflowImportExport({
    canManageWorkflows,
    toast,
    metadata,
    nodes,
    edges,
    setDesignNodes,
    setDesignEdges,
    setExecutionNodes,
    setExecutionEdges,
    setMetadata,
    markDirty,
    resetWorkflow,
    setMode,
  })

  // Wrap change handlers to mark workflow as dirty
  const navigateToSchedules = useCallback(() => {
    if (workflowId) {
      navigate(`/schedules?workflowId=${workflowId}`)
    } else {
      navigate('/schedules')
    }
  }, [navigate, workflowId])

  const onNodesChange = useCallback((changes: any[]) => {
    if (changes.length === 0) {
      return
    }

    const currentNodes = mode === 'design' ? designNodesRef.current : executionNodesRef.current
    const totalEntryNodes = currentNodes.filter(isEntryPointNode).length
    const removingLastEntry = changes.some((change) => {
      if (change.type !== 'remove') return false
      const node = currentNodes.find((n) => n.id === change.id)
      return isEntryPointNode(node) && totalEntryNodes <= 1
    })

    if (removingLastEntry) {
      toast({
        variant: 'destructive',
        title: 'Entry Point required',
        description: 'Each workflow must keep one Entry Point node.',
      })
      return
    }

    const filteredChanges = changes.filter((change) => {
      if (change.type === 'add' && 'item' in change) {
        const node = (change as any).item as ReactFlowNode<FrontendNodeData>
        const currentNodes = mode === 'design' ? designNodesRef.current : executionNodesRef.current
        if (isEntryPointNode(node) && currentNodes.some(isEntryPointNode)) {
          toast({
            variant: 'destructive',
            title: 'Entry Point already exists',
            description: 'Each workflow can only have one Entry Point.',
          })
          return false
        }
      }
      return true
    })

    if (filteredChanges.length === 0) {
      return
    }

    onNodesChangeBase(filteredChanges)

    // Mark design as dirty when nodes change in design mode
    // Execution dirty is tracked separately via useEffect comparing positions
    if (mode === 'design') {
      markDirty()
    }
  }, [onNodesChangeBase, markDirty, mode, toast])

  const onEdgesChange = useCallback((changes: any[]) => {
    onEdgesChangeBase(changes)
    // Mark as dirty when edges change (only in design mode)
    if (mode === 'design' && changes.length > 0) {
      markDirty()
    }
  }, [onEdgesChangeBase, markDirty, mode])
  const { getComponent } = useComponentStore()
  const createEntryPointNode = useCallback((): ReactFlowNode<FrontendNodeData> => {
    const component = getComponent(ENTRY_COMPONENT_ID)
    const slug = component?.slug ?? ENTRY_COMPONENT_SLUG
    return {
      id: `${slug}-${Date.now()}`,
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        label: component?.name ?? 'Entry Point',
        config: {},
        componentId: ENTRY_COMPONENT_ID,
        componentSlug: slug,
        componentVersion: component?.version ?? '1.0.0',
        parameters: {
          runtimeInputs: ENTRY_DEFAULT_RUNTIME_INPUTS.map((input) => ({ ...input })),
        },
        inputs: {},
        status: 'idle',
      },
    }
  }, [getComponent])
  const [isLoading, setIsLoading] = useState(false)
  const isSavingShortcutRef = useRef(false)
  const isLibraryVisible = libraryOpen && mode === 'design'
  const buildGraphSignature = useCallback(
    (
      nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
      edgesSnapshot: ReactFlowEdge[] | null,
    ) => computeGraphSignature(nodesSnapshot, edgesSnapshot),
    []
  )

  const { handleSave, setLastSavedGraphSignature, setLastSavedMetadata } = useDesignWorkflowPersistence({
    canManageWorkflows,
    isDirty,
    isNewWorkflow,
    metadata,
    designNodes,
    designEdges,
    designNodesRef,
    designEdgesRef,
    designSavedSnapshotRef,
    markDirty,
    markClean,
    setWorkflowId,
    setMetadata,
    navigate,
    toast,
    computeGraphSignature: buildGraphSignature,
    workflowRoutePrefix: builderRoutePrefix,
  })

  const {
    mostRecentRunId,
    fetchRuns,
    resetHistoricalTracking,
  } = useWorkflowExecutionLifecycle({
    workflowId,
    metadata: {
      id: metadata.id,
      currentVersionId: metadata.currentVersionId,
    },
    routeRunId,
    selectedRunId,
    mode,
    builderRoutePrefix,
    navigate,
    toast,
    setMode,
    designNodesRef,
    designEdgesRef,
    designSavedSnapshotRef,
    executionNodesRef,
    executionEdgesRef,
    preservedExecutionStateRef,
    executionLoadedSnapshotRef,
    setExecutionNodes,
    setExecutionEdges,
    setExecutionDirty,
  })

  // Track execution dirty state: check if node positions differ from loaded snapshot
  useEffect(() => {
    if (mode !== 'execution' || !executionLoadedSnapshotRef.current) {
      return
    }

    const currentNodes = executionNodesRef.current
    const loadedNodes = executionLoadedSnapshotRef.current.nodes

    if (currentNodes.length !== loadedNodes.length) {
      // Node count changed (shouldn't happen in execution mode, but handle it)
      setExecutionDirty(true)
      return
    }

    // Check if any node positions have changed
    const positionsChanged = currentNodes.some((node) => {
      const loadedNode = loadedNodes.find((n) => n.id === node.id)
      if (!loadedNode) return true // Node added/removed
      return (
        node.position.x !== loadedNode.position.x ||
        node.position.y !== loadedNode.position.y
      )
    })

    setExecutionDirty(positionsChanged)
  }, [executionNodes, mode])

  // Handle mode switching: preserve and restore states cleanly
  const prevModeRef = useRef(mode)

  useLayoutEffect(() => {
    // Only run when mode actually changes
    if (prevModeRef.current === mode) {
      return
    }

    prevModeRef.current = mode

    if (mode === 'execution') {
      // Switching to execution mode: preserve current design state
      preservedDesignStateRef.current = {
        nodes: cloneNodes(designNodesRef.current),
        edges: cloneEdges(designEdgesRef.current),
      }

      // Reset run tracking refs to force the run loading effect to reload
      // This ensures we always load the correct version for the selected run
      resetHistoricalTracking()
      preservedExecutionStateRef.current = null
      // The run loading useEffect will handle loading the correct state
    } else if (mode === 'design') {
      // Switching to design mode: preserve current execution state for potential restoration
      // Note: This is only used if user switches back to execution without changing the run
      preservedExecutionStateRef.current = {
        nodes: cloneNodes(executionNodesRef.current),
        edges: cloneEdges(executionEdgesRef.current),
      }

      // Restore design state from preserved state or saved snapshot
      // Check if preservedDesignStateRef has actual nodes (not empty from early mode switch)
      if (preservedDesignStateRef.current && preservedDesignStateRef.current.nodes.length > 0) {
        setDesignNodes(cloneNodes(preservedDesignStateRef.current.nodes))
        setDesignEdges(cloneEdges(preservedDesignStateRef.current.edges))
        preservedDesignStateRef.current = null
      } else if (designSavedSnapshotRef.current && designSavedSnapshotRef.current.nodes.length > 0) {
        // Fall back to saved snapshot (the loaded workflow state)
        setDesignNodes(cloneNodes(designSavedSnapshotRef.current.nodes))
        setDesignEdges(cloneEdges(designSavedSnapshotRef.current.edges))
      }
      // If both are empty, design state should already be populated by workflow loading
    }
  }, [mode, setDesignNodes, setDesignEdges, setExecutionNodes, setExecutionEdges])
  // Track previous workflow ID to detect workflow switches
  const prevIdForResetRef = useRef<string | undefined>(undefined)

  // CRITICAL: This useLayoutEffect runs BEFORE any useEffect
  // It resets the timeline store and sets the correct mode based on URL
  // This prevents the URL sync effect from using stale selectedRunId from a previous workflow
  useLayoutEffect(() => {
    const isWorkflowChanged = prevIdForResetRef.current !== id
    if (isWorkflowChanged) {
      prevIdForResetRef.current = id
      // When landing on a workflow (not a run), clear any persisted run selection before URL sync
      if (!isRunsRoute && !routeRunId) {
        useExecutionTimelineStore.getState().reset()
      }
    }

    // Determine target mode based on URL
    const targetMode = (isRunsRoute || routeRunId) ? 'execution' : 'design'

    // Only call setMode if the mode is actually different
    // This prevents infinite re-renders from unnecessary state updates
    const currentMode = useWorkflowUiStore.getState().mode
    if (currentMode !== targetMode) {
      setMode(targetMode)
    }
  }, [id, isRunsRoute, routeRunId, setMode])

  // NOTE: URL is the source of truth for mode
  // - The useLayoutEffect above sets mode based on URL
  // - Tab clicks should call navigate() to change URL, not setMode()
  // - The URL change triggers useLayoutEffect which updates mode

  // Track previous workflow ID to prevent unnecessary reloads
  const prevWorkflowIdRef = useRef<string | null | undefined>(undefined)

  // Load workflow on mount (if not new)
  // Only reload when workflow ID actually changes, not on mode changes
  useEffect(() => {
    // Skip if workflow ID hasn't changed (prevents reloading on mode switches)
    // Use undefined check to allow initial load
    if (prevWorkflowIdRef.current !== undefined && id === prevWorkflowIdRef.current) {
      return
    }
    prevWorkflowIdRef.current = id ?? null

    // Keep store workflow id aligned with the routed workflow to avoid URL rewrites to the previous id
    if (!isNewWorkflow && id && metadata.id !== id) {
      setWorkflowId(id)
    }

    const loadWorkflow = async () => {
      // Reset execution state if switching workflows to prevent leaks
      // This ensures we don't show status/logs from a previous workflow
      const executionStore = useExecutionStore.getState()
      if (id && executionStore.workflowId !== id) {
        executionStore.reset()
        // Timeline store already reset synchronously above
      }

      if (isNewWorkflow) {
        if (designNodesRef.current.length === 0) {
          resetWorkflow()
          const entryNode = createEntryPointNode()
          // Initialize both design and execution states with the same initial state
          setDesignNodes([entryNode])
          setDesignEdges([])
          setExecutionNodes([entryNode])
          setExecutionEdges([])
          resetHistoricalTracking()

          // Initialize saved snapshot for new workflow
          designSavedSnapshotRef.current = {
            nodes: cloneNodes([entryNode]),
            edges: cloneEdges([]),
          }
          executionLoadedSnapshotRef.current = {
            nodes: cloneNodes([entryNode]),
            edges: cloneEdges([]),
          }

          const baseMetadata = useWorkflowStore.getState().metadata
          setLastSavedGraphSignature(computeGraphSignature([entryNode], []))
          setLastSavedMetadata({
            name: baseMetadata.name,
            description: baseMetadata.description ?? '',
          })
        }
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

        const hasRunContext = Boolean(routeRunId || selectedRunId)

        // Deserialize and set nodes/edges
        const workflowEdges = deserializeEdges(workflow)
        const workflowNodes = deserializeNodes(workflow)

        // Initialize design state with the loaded workflow
        setDesignNodes(workflowNodes)
        setDesignEdges(workflowEdges)

        // Initialize execution state only when there's no run context; otherwise the execution
        // lifecycle hook will load the appropriate version for the routed run.
        const shouldInitializeExecution =
          !hasRunContext && (executionNodesRef.current.length === 0 || executionEdgesRef.current.length === 0)

        if (shouldInitializeExecution) {
          setExecutionNodes(cloneNodes(workflowNodes))
          setExecutionEdges(cloneEdges(workflowEdges))
        }

        resetHistoricalTracking()

        // Store saved snapshot (last saved state) for execution mode initialization
        designSavedSnapshotRef.current = {
          nodes: cloneNodes(workflowNodes),
          edges: cloneEdges(workflowEdges),
        }

        // Initialize execution loaded snapshot
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(workflowNodes),
          edges: cloneEdges(workflowEdges),
        }

        // Mark as clean (no unsaved changes)
        markClean()
        const loadedSignature = computeGraphSignature(workflowNodes, workflowEdges)
        setLastSavedGraphSignature(loadedSignature)
        setLastSavedMetadata({
          name: workflow.name,
          description: workflow.description ?? '',
        })

        // Analytics: builder loaded (existing workflow)
        track(Events.WorkflowBuilderLoaded, {
          workflow_id: workflow.id,
          is_new: false,
          node_count: workflowNodes.length,
        })

        // Check for active runs to resume monitoring
        // Only auto-switch to live mode if we opened via a runs URL (execution mode)
        // For design mode, just set up background monitoring without switching views
        const openedInExecutionMode = Boolean(routeRunId) || isRunsRoute
        try {
          const { runs } = await api.executions.listRuns({
            workflowId: workflow.id,
            limit: 1,
          })

          if (runs && runs.length > 0) {
            const latestRun = runs[0]
            if (latestRun && latestRun.id && latestRun.status) {
              const isActive = ['QUEUED', 'RUNNING'].includes(latestRun.status)
              if (isActive) {
                console.log('[WorkflowBuilder] Found active run, resuming monitoring:', latestRun.id)

                // Resume monitoring in execution store (always - this is background work)
                useExecutionStore.getState().monitorRun(latestRun.id, workflow.id)

                // Only switch timeline to live mode if we opened via execution URL
                // This prevents the jarring switch from design to execution when opening from workflow list
                if (openedInExecutionMode) {
                  useExecutionTimelineStore.getState().selectRun(latestRun.id, 'live')

                  toast({
                    title: 'Resumed live monitoring',
                    description: `Connected to active run ${latestRun.id.slice(-6)}`,
                  })
                }
              }
            }
          }
        } catch (error) {
          console.error('Failed to check for active runs:', error)
        }
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
  }, [
    id,
    isNewWorkflow,
    navigate,
    setMetadata,
    setWorkflowId,
    setDesignNodes,
    setDesignEdges,
    setExecutionNodes,
    setExecutionEdges,
    resetWorkflow,
    markClean,
    setLastSavedGraphSignature,
    setLastSavedMetadata,
    createEntryPointNode,
    routeRunId,
    selectedRunId,
    resetHistoricalTracking,
    metadata.id,
  ])

  const resolveRuntimeInputDefinitions = useCallback(() => {
    const triggerNode = nodes.find(node => {
      const nodeData = node.data as any
      const componentRef = nodeData.componentId ?? nodeData.componentSlug
      const component = getComponent(componentRef)
      return component?.id === 'core.workflow.entrypoint'
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


  const {
    runDialogOpen,
    setRunDialogOpen,
    runtimeInputs,
    prefilledRuntimeValues,
    pendingVersionId,
    handleRun,
    handleRerunFromTimeline,
    executeWorkflow,
  } = useWorkflowRunner({
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
    workflowRoutePrefix: builderRoutePrefix,
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      const key = event.key?.toLowerCase()

      // Save shortcut: Ctrl/Cmd + S
      const isSaveCombo = (event.metaKey || event.ctrlKey) && key === 's'
      if (isSaveCombo && mode === 'design') {
        event.preventDefault()
        event.stopPropagation()
        if (!isSavingShortcutRef.current) {
          isSavingShortcutRef.current = true
          void handleSave().finally(() => {
            isSavingShortcutRef.current = false
          })
        }
        return
      }

      // Demo components toggle shortcut: Ctrl/Cmd + Shift + D
      const isDemoToggleCombo = (event.metaKey || event.ctrlKey) && event.shiftKey && key === 'd'
      if (isDemoToggleCombo) {
        event.preventDefault()
        event.stopPropagation()
        toggleDemoComponents()
        const isNowVisible = !showDemoComponents // because it was just toggled
        toast({
          title: isNowVisible ? 'Demo components enabled' : 'Demo components disabled',
          duration: 2000,
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, mode, toggleDemoComponents, showDemoComponents, toast])


  // Show inspector if there's an active run OR if mode is execution
  // This allows smooth transition without forcing mode change
  const isInspectorVisible = mode === 'execution' || (selectedRunId !== null && mode !== 'design')

  const shouldShowInitialLoader = isLoading && designNodes.length === 0 && executionNodes.length === 0 && !isNewWorkflow

  // Only show full-screen loading during initial load, not during mode switches
  // Check if we have nodes in either mode to avoid showing during mode switches
  if (shouldShowInitialLoader) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    )
  }

  const topBarNode = (
    <TopBar
      workflowId={id}
      selectedRunId={selectedRunId}
      isNew={isNewWorkflow}
      onRun={handleRun}
      onSave={handleSave}
      onImport={handleImportWorkflow}
      onExport={handleExportWorkflow}
      canManageWorkflows={canManageWorkflows}
    />
  )

  const shouldShowSummary = mode === 'design'

  const designerCanvas = (
    <WorkflowDesignerPane
      workflowId={workflowId}
      workflowName={workflowName}
      nodes={nodes}
      edges={edges}
      setNodes={setNodes}
      setEdges={setEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      showSummary={shouldShowSummary}
      onNavigateToSchedules={navigateToSchedules}
    />
  )

  const executionCanvas = (
    <WorkflowExecutionPane
      workflowId={workflowId}
      nodes={nodes}
      edges={edges}
      setNodes={setNodes}
      setEdges={setEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
    />
  )

  const canvasContent = mode === 'design' ? designerCanvas : executionCanvas

  const inspectorContent = <ExecutionInspector onRerunRun={handleRerunFromTimeline} />

  const runDialogNode = (
    <RunWorkflowDialog
      open={runDialogOpen}
      onOpenChange={setRunDialogOpen}
      runtimeInputs={runtimeInputs}
      initialValues={prefilledRuntimeValues}
      onRun={(inputs) => executeWorkflow({ inputs, versionId: pendingVersionId })}
    />
  )

  return (
    <WorkflowBuilderShell
      mode={mode}
      topBar={topBarNode}
      isLibraryVisible={isLibraryVisible}
      onToggleLibrary={toggleLibrary}
      libraryContent={<Sidebar />}
      canvasContent={canvasContent}
      showScheduleSidebarContainer={false}
      isScheduleSidebarVisible={false}
      scheduleSidebarContent={null}
      isInspectorVisible={isInspectorVisible}
      inspectorContent={inspectorContent}
      inspectorWidth={inspectorWidth}
      setInspectorWidth={setInspectorWidth}
      showLoadingOverlay={shouldShowInitialLoader}
      scheduleDrawer={null}
      runDialog={runDialogNode}
    />
  )
}

export function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderContent />
    </ReactFlowProvider>
  )
}
