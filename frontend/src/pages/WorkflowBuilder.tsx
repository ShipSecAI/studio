import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus, Loader2, Pencil, Play, Pause, Zap, ExternalLink, Trash2, X } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useComponentStore } from '@/store/componentStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useRunStore, type ExecutionRun } from '@/store/runStore'
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
import type { ExecutionStatus } from '@/schemas/execution'
import { useAuthStore } from '@/store/authStore'
import { hasAdminRole } from '@/utils/auth'
import { WorkflowImportSchema, DEFAULT_WORKFLOW_VIEWPORT } from '@/schemas/workflow'
import { track, Events } from '@/features/analytics/events'
import { ScheduleEditorDrawer, type WorkflowOption } from '@/components/schedules/ScheduleEditorDrawer'
import type { WorkflowSchedule } from '@shipsec/shared'

const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint'
const ENTRY_COMPONENT_SLUG = 'entry-point'
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

const TERMINAL_RUN_STATUSES: ExecutionStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
]

const normalizeRunSummary = (run: any): ExecutionRun => {
  const status = (typeof run.status === 'string' ? run.status.toUpperCase() : 'FAILED') as ExecutionStatus
  const startTime =
    typeof run.startTime === 'string' ? run.startTime : new Date().toISOString()
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

const isRunLive = (run?: ExecutionRun | null) => {
  if (!run) {
    return false
  }
  if (run.isLive) {
    return true
  }
  return !TERMINAL_RUN_STATUSES.includes(run.status)
}

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

const formatScheduleTimestamp = (value?: string | null) => {
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

const scheduleStatusVariant: Record<
  WorkflowSchedule['status'],
  'default' | 'secondary' | 'destructive'
> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
}

function WorkflowBuilderContent() {
  const { id, runId: routeRunId } = useParams<{ id: string; runId?: string }>()
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
  // Separate state for design and execution modes
  const [designNodes, setDesignNodes, onDesignNodesChangeBase] = useNodesState<FrontendNodeData>([])
  const [designEdges, setDesignEdges, onDesignEdgesChangeBase] = useEdgesState([])
  const [executionNodes, setExecutionNodes, onExecutionNodesChangeBase] = useNodesState<FrontendNodeData>([])
  const [executionEdges, setExecutionEdges, onExecutionEdgesChangeBase] = useEdgesState([])

  // Execution dirty state: tracks if nodes have been rearranged in execution mode
  const [_executionDirty, setExecutionDirty] = useState(false)

  // Preserved design state snapshot (for restoration when switching back from execution)
  const preservedDesignStateRef = useRef<{
    nodes: ReactFlowNode<FrontendNodeData>[]
    edges: ReactFlowEdge[]
  } | null>(null)

  // Preserved execution state snapshot (for restoration when switching back to execution)
  const preservedExecutionStateRef = useRef<{
    nodes: ReactFlowNode<FrontendNodeData>[]
    edges: ReactFlowEdge[]
  } | null>(null)

  // Design saved snapshot (last saved state) - used to initialize execution state
  const designSavedSnapshotRef = useRef<{
    nodes: ReactFlowNode<FrontendNodeData>[]
    edges: ReactFlowEdge[]
  } | null>(null)

  // Execution loaded snapshot (original state when run was loaded) - used to detect position changes
  const executionLoadedSnapshotRef = useRef<{
    nodes: ReactFlowNode<FrontendNodeData>[]
    edges: ReactFlowEdge[]
  } | null>(null)

  const roles = useAuthStore((state) => state.roles)
  const canManageWorkflows = hasAdminRole(roles)
  const { toast } = useToast()
  const mode = useWorkflowUiStore((state) => state.mode)

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
  const [workflowSchedules, setWorkflowSchedules] = useState<WorkflowSchedule[]>([])
  const [workflowSchedulesLoading, setWorkflowSchedulesLoading] = useState(false)
  const [workflowSchedulesError, setWorkflowSchedulesError] = useState<string | null>(null)
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false)
  const [scheduleEditorMode, setScheduleEditorMode] = useState<'create' | 'edit'>('create')
  const [editingSchedule, setEditingSchedule] = useState<WorkflowSchedule | null>(null)
  const [schedulePanelExpanded, setSchedulePanelExpanded] = useState(false)
  const [hasSelectedNode, setHasSelectedNode] = useState(false)
  const scheduleWorkflowOptions = useMemo<WorkflowOption[]>(() => {
    if (!workflowId) return []
    return [
      {
        id: workflowId,
        name: workflowName,
      },
    ]
  }, [workflowId, workflowName])

  // Wrap change handlers to mark workflow as dirty
  const navigateToSchedules = useCallback(() => {
    if (workflowId) {
      navigate(`/schedules?workflowId=${workflowId}`)
    } else {
      navigate('/schedules')
    }
  }, [navigate, workflowId])

  const refreshWorkflowSchedules = useCallback(async () => {
    if (!workflowId) {
      setWorkflowSchedules([])
      setWorkflowSchedulesError(null)
      return
    }
    setWorkflowSchedulesLoading(true)
    try {
      const list = await api.schedules.list({ workflowId })
      setWorkflowSchedules(list)
      setWorkflowSchedulesError(null)
    } catch (error) {
      console.error('Failed to load workflow schedules', error)
      setWorkflowSchedulesError(
        error instanceof Error ? error.message : 'Failed to load schedules',
      )
    } finally {
      setWorkflowSchedulesLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    if (!workflowId) {
      setWorkflowSchedules([])
      return
    }
    void refreshWorkflowSchedules()
  }, [workflowId, refreshWorkflowSchedules])

  const openScheduleDrawer = useCallback(
    (mode: 'create' | 'edit', schedule?: WorkflowSchedule | null) => {
      if (!workflowId) {
        toast({
          title: 'Save workflow to manage schedules',
          description: 'Schedules can be created after the workflow has an ID.',
          variant: 'destructive',
        })
        return
      }
      setScheduleEditorMode(mode)
      setEditingSchedule(schedule ?? null)
      setScheduleEditorOpen(true)
    },
    [toast, workflowId],
  )

  const handleScheduleSaved = useCallback(
    (schedule: WorkflowSchedule, _mode: 'create' | 'edit') => {
      setScheduleEditorOpen(false)
      setEditingSchedule(null)
      // Optimistically update list
      setWorkflowSchedules((prev) => {
        const exists = prev.find((item) => item.id === schedule.id)
        if (exists) {
          return prev.map((item) => (item.id === schedule.id ? schedule : item))
        }
        return [...prev, schedule]
      })
      void refreshWorkflowSchedules()
    },
    [refreshWorkflowSchedules],
  )

  const handleScheduleAction = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      try {
        if (action === 'pause') {
          await api.schedules.pause(schedule.id)
          toast({ title: 'Schedule paused', description: schedule.name })
        } else if (action === 'resume') {
          await api.schedules.resume(schedule.id)
          toast({ title: 'Schedule resumed', description: schedule.name })
        } else {
          await api.schedules.runNow(schedule.id)
          toast({ title: 'Schedule triggered', description: schedule.name })
        }
        void refreshWorkflowSchedules()
      } catch (error) {
        toast({
          title: 'Schedule action failed',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        })
      }
    },
    [refreshWorkflowSchedules, toast],
  )

  const handleScheduleDelete = useCallback(
    async (schedule: WorkflowSchedule) => {
      if (!confirm(`Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`)) {
        return
      }
      try {
        await api.schedules.delete(schedule.id)
        toast({
          title: 'Schedule deleted',
          description: `"${schedule.name}" has been deleted.`,
        })
        void refreshWorkflowSchedules()
      } catch (error) {
        toast({
          title: 'Failed to delete schedule',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        })
      }
    },
    [refreshWorkflowSchedules, toast],
  )

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
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runtimeInputs, setRuntimeInputs] = useState<any[]>([])
  const [prefilledRuntimeValues, setPrefilledRuntimeValues] = useState<Record<string, unknown>>({})
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null)
  const [lastSavedGraphSignature, setLastSavedGraphSignature] = useState<string | null>(null)
  const [lastSavedMetadata, setLastSavedMetadata] = useState<{ name: string; description: string } | null>(null)
  const isSavingShortcutRef = useRef(false)
  const [hasGraphChanges, setHasGraphChanges] = useState(false)
  const [hasMetadataChanges, setHasMetadataChanges] = useState(false)
  const libraryOpen = useWorkflowUiStore((state) => state.libraryOpen)
  const toggleLibrary = useWorkflowUiStore((state) => state.toggleLibrary)
  const inspectorWidth = useWorkflowUiStore((state) => state.inspectorWidth)
  const setInspectorWidth = useWorkflowUiStore((state) => state.setInspectorWidth)
  const setMode = useWorkflowUiStore((state) => state.setMode)
  const selectRun = useExecutionTimelineStore((state) => state.selectRun)
  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId)
  const fetchRuns = useRunStore((state) => state.fetchRuns)
  const refreshRuns = useRunStore((state) => state.refreshRuns)
  const getRunById = useRunStore((state) => state.getRunById)
  const upsertRun = useRunStore((state) => state.upsertRun)
  const workflowCacheKey = metadata.id ?? '__global__'
  const scopedRuns = useRunStore((state) => state.cache[workflowCacheKey]?.runs)
  const runs = scopedRuns ?? []
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const inspectorResizingRef = useRef(false)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const isLibraryVisible = libraryOpen && mode === 'design'
  const [showLibraryContent, setShowLibraryContent] = useState(isLibraryVisible)
  const [historicalVersionId, setHistoricalVersionId] = useState<string | null>(null)
  const designNodesRef = useRef(designNodes)
  const designEdgesRef = useRef(designEdges)
  const executionNodesRef = useRef(executionNodes)
  const executionEdgesRef = useRef(executionEdges)

  useEffect(() => {
    designNodesRef.current = designNodes
  }, [designNodes])

  useEffect(() => {
    designEdgesRef.current = designEdges
  }, [designEdges])

  useEffect(() => {
    executionNodesRef.current = executionNodes
  }, [executionNodes])

  useEffect(() => {
    executionEdgesRef.current = executionEdges
  }, [executionEdges])

  const buildGraphSignature = useCallback(
    (
      nodesSnapshot: ReactFlowNode<FrontendNodeData>[] | null,
      edgesSnapshot: ReactFlowEdge[] | null,
    ) => computeGraphSignature(nodesSnapshot, edgesSnapshot),
    []
  )

  // Track graph changes only for design state (dirty tracking)
  useEffect(() => {
    const currentSignature = buildGraphSignature(designNodes, designEdges)

    if (lastSavedGraphSignature === null) {
      setLastSavedGraphSignature(currentSignature)
      setHasGraphChanges(false)
      return
    }

    setHasGraphChanges(currentSignature !== lastSavedGraphSignature)
  }, [designNodes, designEdges, buildGraphSignature, lastSavedGraphSignature])

  useEffect(() => {
    const normalizedMetadata = {
      name: metadata.name,
      description: metadata.description ?? '',
    }

    if (lastSavedMetadata === null) {
      setLastSavedMetadata(normalizedMetadata)
      setHasMetadataChanges(false)
      return
    }

    const changed =
      normalizedMetadata.name !== lastSavedMetadata.name ||
      normalizedMetadata.description !== lastSavedMetadata.description
    setHasMetadataChanges(changed)
  }, [metadata.name, metadata.description, lastSavedMetadata])

  useEffect(() => {
    const shouldBeDirty = hasGraphChanges || hasMetadataChanges
    if (shouldBeDirty && !isDirty) {
      markDirty()
    } else if (!shouldBeDirty && isDirty) {
      markClean()
    }
  }, [hasGraphChanges, hasMetadataChanges, isDirty, markDirty, markClean])

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

      // If we have preserved execution state, restore it (user had rearranged nodes)
      if (preservedExecutionStateRef.current) {
        setExecutionNodes(cloneNodes(preservedExecutionStateRef.current.nodes))
        setExecutionEdges(cloneEdges(preservedExecutionStateRef.current.edges))
        preservedExecutionStateRef.current = null
      }
      // Otherwise, let the run loading useEffect handle loading the correct state
    } else if (mode === 'design') {
      // Switching to design mode: preserve current execution state
      preservedExecutionStateRef.current = {
        nodes: cloneNodes(executionNodesRef.current),
        edges: cloneEdges(executionEdgesRef.current),
      }

      // Restore preserved design state if it exists
      if (preservedDesignStateRef.current) {
        setDesignNodes(cloneNodes(preservedDesignStateRef.current.nodes))
        setDesignEdges(cloneEdges(preservedDesignStateRef.current.edges))
        preservedDesignStateRef.current = null
      }
      // Otherwise, design state should already be loaded from saved snapshot
    }
  }, [mode, setDesignNodes, setDesignEdges, setExecutionNodes, setExecutionEdges])
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
    if (!metadata.id || !routeRunId || selectedRunId === routeRunId) {
      return
    }

    let cancelled = false

    const ensureRouteRun = async () => {
      let targetRun = getRunById(routeRunId)

      if (!targetRun) {
        try {
          await refreshRuns(metadata.id)
          targetRun = getRunById(routeRunId)
        } catch (error) {
          console.error('Failed to refresh runs for route:', error)
        }
      }

      if (!targetRun) {
        try {
          const runDetails = await api.executions.getRun(routeRunId)
          if (cancelled) return
          const normalized = normalizeRunSummary(runDetails)
          upsertRun(normalized)
          targetRun = normalized
        } catch (error) {
          if (cancelled) return
          console.error('Failed to load workflow run from route:', error)
          toast({
            variant: 'destructive',
            title: 'Run not found',
            description: 'This execution may have been deleted or is no longer available.',
          })
          navigate(`/workflows/${metadata.id}`, { replace: true })
          return
        }
      }

      if (cancelled || !targetRun) {
        return
      }

      if (targetRun.workflowId && targetRun.workflowId !== metadata.id) {
        navigate(`/workflows/${targetRun.workflowId}/runs/${routeRunId}`, { replace: true })
        return
      }

      try {
        await selectRun(routeRunId, isRunLive(targetRun) ? 'live' : 'replay')
        if (isRunLive(targetRun)) {
          useExecutionStore.getState().monitorRun(routeRunId, targetRun.workflowId)
        }
      } catch (error) {
        console.error('Failed to select run from route:', error)
      }
    }

    void ensureRouteRun()

    return () => {
      cancelled = true
    }
  }, [metadata.id, routeRunId, selectedRunId, refreshRuns, getRunById, upsertRun, selectRun, navigate, toast])

  // Track previous run ID and version ID to detect actual changes (not just array reference changes)
  const prevRunIdRef = useRef<string | null>(null)
  const prevVersionIdRef = useRef<string | null>(null)

  // Load workflow version for execution mode when a run is selected
  useEffect(() => {
    // Only load versions in execution mode
    if (mode !== 'execution' || !metadata.id) {
      return
    }

    let run = workflowRuns.find((candidate) => candidate.id === selectedRunId)

    // If no run selected, try to use most recent run
    if (!run && mostRecentRunId) {
      run = workflowRuns.find((candidate) => candidate.id === mostRecentRunId)
    }

    const versionId = run?.workflowVersionId ?? null
    const currentRunId = run?.id ?? null

    // Only reload nodes if the run ID or version ID actually changed
    // This prevents unnecessary reloads when workflowRuns array reference changes due to polling
    const runIdChanged = currentRunId !== prevRunIdRef.current
    const versionIdChanged = versionId !== prevVersionIdRef.current

    // If run ID changed, clear preserved execution state (user switched to a different run)
    if (runIdChanged && prevRunIdRef.current !== null) {
      preservedExecutionStateRef.current = null
      setExecutionDirty(false)
    }

    // If neither run ID nor version ID changed, skip reloading (prevents resetting viewport during polling)
    if (!runIdChanged && !versionIdChanged && prevRunIdRef.current !== null) {
      return
    }

    // Update refs to track current state
    prevRunIdRef.current = currentRunId
    prevVersionIdRef.current = versionId

    // If no run found, or run uses current version, use saved design state as execution state
    if (!run || !versionId || versionId === metadata.currentVersionId) {
      // Clear preserved execution state since we're loading a fresh state
      preservedExecutionStateRef.current = null
      setExecutionDirty(false)

      // Load from saved design snapshot (last saved state)
      if (designSavedSnapshotRef.current) {
        const savedNodes = cloneNodes(designSavedSnapshotRef.current.nodes)
        const savedEdges = cloneEdges(designSavedSnapshotRef.current.edges)
        // Preserve terminal nodes when updating execution nodes
        const terminalNodes = executionNodes.filter((n) => n.type === 'terminal')
        setExecutionNodes([...savedNodes, ...terminalNodes])
        setExecutionEdges(savedEdges)
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(savedNodes),
          edges: cloneEdges(savedEdges),
        }
      } else {
        // Fallback to current design state if no saved snapshot (shouldn't happen for saved workflows)
        const designNodes = cloneNodes(designNodesRef.current)
        const designEdges = cloneEdges(designEdgesRef.current)
        // Preserve terminal nodes when updating execution nodes
        const terminalNodes = executionNodes.filter((n) => n.type === 'terminal')
        setExecutionNodes([...designNodes, ...terminalNodes])
        setExecutionEdges(designEdges)
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(designNodes),
          edges: cloneEdges(designEdges),
        }
      }

      if (historicalVersionId) {
        setHistoricalVersionId(null)
      }
      return
    }

    // If we already loaded this version, skip (preserved execution state will be restored by mode switch handler)
    if (versionId === historicalVersionId) {
      return
    }

    // Clear preserved execution state when loading a new run version
    preservedExecutionStateRef.current = null
    setExecutionDirty(false)

    let cancelled = false

    const loadExecutionVersion = async () => {
      try {
        const workflowIdForRun = run.workflowId ?? metadata.id
        if (!workflowIdForRun) {
          return
        }

        const version = await api.workflows.getVersion(workflowIdForRun, versionId)
        if (cancelled) return

        const versionNodes = deserializeNodes(version)
        const versionEdges = deserializeEdges(version)

        // Load into execution state and set loaded snapshot
        // Preserve terminal nodes when updating execution nodes
        const terminalNodes = executionNodes.filter((n) => n.type === 'terminal')
        setExecutionNodes([...versionNodes, ...terminalNodes])
        setExecutionEdges(versionEdges)
        executionLoadedSnapshotRef.current = {
          nodes: cloneNodes(versionNodes),
          edges: cloneEdges(versionEdges),
        }
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

    loadExecutionVersion()

    return () => {
      cancelled = true
    }
  }, [
    mode,
    metadata.id,
    metadata.currentVersionId,
    workflowRuns, // Keep workflowRuns to detect when run data is available, but we check for actual changes inside
    selectedRunId,
    mostRecentRunId, // Track mostRecentRunId to detect when it changes
    historicalVersionId,
    executionNodes, // Need executionNodes to preserve terminal nodes
    setExecutionNodes,
    setExecutionEdges,
    toast,
  ])

  useEffect(() => {
    if (!runDialogOpen) {
      setPrefilledRuntimeValues({})
      setPendingVersionId(null)
    }
  }, [runDialogOpen])
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

    const loadWorkflow = async () => {
      // Reset execution state if switching workflows to prevent leaks
      // This ensures we don't show status/logs from a previous workflow
      const executionStore = useExecutionStore.getState()
      if (id && executionStore.workflowId !== id) {
        executionStore.reset()
        useExecutionTimelineStore.getState().reset()
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
          setHistoricalVersionId(null)

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
          setHasGraphChanges(false)
          setHasMetadataChanges(false)
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

        // Deserialize and set nodes/edges for both design and execution states
        const workflowEdges = deserializeEdges(workflow)
        const workflowNodes = deserializeNodes(workflow)

        // Initialize both states with the loaded workflow
        setDesignNodes(workflowNodes)
        setDesignEdges(workflowEdges)
        setExecutionNodes(cloneNodes(workflowNodes))
        setExecutionEdges(cloneEdges(workflowEdges))
        setHistoricalVersionId(null)

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
        setHasGraphChanges(false)
        setHasMetadataChanges(false)

        // Analytics: builder loaded (existing workflow)
        track(Events.WorkflowBuilderLoaded, {
          workflow_id: workflow.id,
          is_new: false,
          node_count: workflowNodes.length,
        })

        // Check for active runs to resume monitoring
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

                // Resume monitoring in execution store
                useExecutionStore.getState().monitorRun(latestRun.id, workflow.id)

                // Switch timeline to live mode
                useExecutionTimelineStore.getState().selectRun(latestRun.id, 'live')

                toast({
                  title: 'Resumed live monitoring',
                  description: `Connected to active run ${latestRun.id.slice(-6)}`,
                })
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
    setDesignNodes,
    setDesignEdges,
    setExecutionNodes,
    setExecutionEdges,
    resetWorkflow,
    markClean,
    setLastSavedGraphSignature,
    setLastSavedMetadata,
    setHasGraphChanges,
    setHasMetadataChanges,
    createEntryPointNode,
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

    if (isDirty) {
      toast({
        variant: 'warning',
        title: 'Save changes before running',
        description: 'Unsaved edits stay in the builder. Save to create a new version before executing.',
      })
      return
    }

    // Don't set isLoading - that's only for initial workflow load
    // Running a workflow shouldn't show the "Loading workflow..." screen
    try {
      const shouldCommitBeforeRun =
        !options?.versionId &&
        !metadata.currentVersionId

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
        // Navigate to the new run URL so user can see and share it
        navigate(`/workflows/${workflowId}/runs/${runId}`, { replace: true })
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
      // Set both design and execution states when importing
      setDesignNodes(normalizedNodes)
      setDesignEdges(normalizedEdges)
      setExecutionNodes(cloneNodes(normalizedNodes))
      setExecutionEdges(cloneEdges(normalizedEdges))
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

  const handleSave = useCallback(async (showToast: boolean = true) => {
    if (!canManageWorkflows) {
      if (showToast) {
        toast({
          variant: 'destructive',
          title: 'Insufficient permissions',
          description: 'Only administrators can save workflow changes.',
        })
      }
      return
    }

    if (!isDirty) {
      if (showToast) {
        toast({
          title: 'No changes to save',
          description: 'Your workflow matches the last saved version.',
        })
      }
      return
    }

    try {
      // Defensive check for undefined nodes/edges
      if (!nodes || !Array.isArray(nodes)) {
        if (showToast) {
          toast({
            variant: 'destructive',
            title: 'Cannot save workflow',
            description: 'Invalid workflow nodes data.',
          })
        }
        return
      }

      if (!edges || !Array.isArray(edges)) {
        if (showToast) {
          toast({
            variant: 'destructive',
            title: 'Cannot save workflow',
            description: 'Invalid workflow edges data.',
          })
        }
        return
      }

      // Determine if this is a create or update operation
      const workflowId = metadata.id
      const metadataChangesOnly = hasMetadataChanges && !hasGraphChanges

      if (metadataChangesOnly && workflowId && !isNewWorkflow) {
        const updatedMetadata = await api.workflows.updateMetadata(workflowId, {
          name: metadata.name,
          description: metadata.description ?? '',
        })

        setMetadata({
          id: updatedMetadata.id,
          name: updatedMetadata.name,
          description: updatedMetadata.description ?? '',
          currentVersionId: updatedMetadata.currentVersionId ?? null,
          currentVersion: updatedMetadata.currentVersion ?? null,
        })

        setLastSavedMetadata({
          name: updatedMetadata.name,
          description: updatedMetadata.description ?? '',
        })
        setHasMetadataChanges(false)
        markClean()

        if (showToast) {
          toast({
            variant: 'success',
            title: 'Workflow details updated',
            description: 'Name and description have been synced.',
          })
        }
        return
      }

      if (!workflowId || isNewWorkflow) {
        // Block creating a brand-new workflow with no nodes (backend expects at least one)
        if (designNodes.length === 0) {
          if (showToast) {
            toast({
              variant: 'destructive',
              title: 'Cannot save workflow',
              description: 'Add at least one component before saving.',
            })
          }
          return
        }
        // Create new workflow (always save from design state)
        const payload = serializeWorkflowForCreate(
          metadata.name,
          metadata.description || undefined,
          designNodes,
          designEdges
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
        const newSignature = buildGraphSignature(
          designNodesRef.current,
          designEdgesRef.current,
        )
        setLastSavedGraphSignature(newSignature)
        setLastSavedMetadata({
          name: savedWorkflow.name,
          description: savedWorkflow.description ?? '',
        })
        setHasGraphChanges(false)
        setHasMetadataChanges(false)

        // Update saved snapshot (last saved state) for execution mode initialization
        designSavedSnapshotRef.current = {
          nodes: cloneNodes(designNodesRef.current),
          edges: cloneEdges(designEdgesRef.current),
        }

        // Navigate to the new workflow URL
        navigate(`/workflows/${savedWorkflow.id}`, { replace: true })

        // Analytics: workflow created
        track(Events.WorkflowCreated, {
          workflow_id: savedWorkflow.id,
          node_count: designNodes.length,
          edge_count: designEdges.length,
        })

        if (showToast) {
          toast({
            variant: 'success',
            title: 'Workflow created',
            description: 'Your workflow has been saved and is ready to run.',
          })
        }
      } else {
        // Update existing workflow (always save from design state)
        const payload = serializeWorkflowForUpdate(
          workflowId,
          metadata.name,
          metadata.description || undefined,
          designNodes,
          designEdges
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
        const newSignature = buildGraphSignature(
          designNodesRef.current,
          designEdgesRef.current,
        )
        setLastSavedGraphSignature(newSignature)
        setLastSavedMetadata({
          name: updatedWorkflow.name,
          description: updatedWorkflow.description ?? '',
        })
        setHasGraphChanges(false)
        setHasMetadataChanges(false)

        // Update saved snapshot (last saved state) for execution mode initialization
        designSavedSnapshotRef.current = {
          nodes: cloneNodes(designNodesRef.current),
          edges: cloneEdges(designEdgesRef.current),
        }

        // Analytics: workflow saved
        track(Events.WorkflowSaved, {
          workflow_id: updatedWorkflow.id,
          node_count: nodes.length,
          edge_count: edges.length,
        })

        if (showToast) {
          toast({
            variant: 'success',
            title: 'Workflow saved',
            description: 'All changes have been saved.',
          })
        }
      }
    } catch (error) {
      console.error('Failed to save workflow:', error)

      // Always show error toasts so users know manual saves failed
      // Check if it's a network error (backend not available)
      const isNetworkError = error instanceof Error &&
        (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

      if (isNetworkError) {
        if (showToast) {
          toast({
            variant: 'destructive',
            title: 'Cannot connect to backend',
            description: `Ensure the backend is running at ${API_BASE_URL}. Your workflow remains available locally.`,
          })
        }
      } else {
        if (showToast) {
          toast({
            variant: 'destructive',
            title: 'Failed to save workflow',
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }
  }, [
    canManageWorkflows,
    nodes,
    edges,
    metadata,
    hasGraphChanges,
    hasMetadataChanges,
    isNewWorkflow,
    toast,
    setWorkflowId,
    setMetadata,
    markClean,
    navigate,
    isDirty,
    buildGraphSignature,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      const key = event.key?.toLowerCase()
      const isSaveCombo = (event.metaKey || event.ctrlKey) && key === 's'

      if (!isSaveCombo || mode !== 'design') {
        return
      }

      // Allow the shortcut even while typing, but avoid hijacking other embedded apps that might prevent default
      event.preventDefault()
      event.stopPropagation()

      if (isSavingShortcutRef.current) {
        return
      }

      isSavingShortcutRef.current = true
      void handleSave().finally(() => {
        isSavingShortcutRef.current = false
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, mode])


  const handleInspectorResizeStart = useCallback((event: React.MouseEvent) => {
    if (mode !== 'execution') {
      return
    }
    inspectorResizingRef.current = true
    setIsInspectorResizing(true)
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
        setIsInspectorResizing(false)
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

  // Only show full-screen loading during initial load, not during mode switches
  // Check if we have nodes in either mode to avoid showing during mode switches
  if (isLoading && designNodes.length === 0 && executionNodes.length === 0 && !isNewWorkflow) {
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
      <div ref={layoutRef} className="flex flex-1 overflow-hidden relative">
        {/* Show components button - anchored to layout when tray is hidden */}
        {mode === 'design' && !isLibraryVisible && (
          <Button
            type="button"
            variant="secondary"
            onClick={toggleLibrary}
            className="absolute z-[60] top-[10px] left-[10px] h-8 px-3 py-1.5 flex items-center gap-2 rounded-md border bg-background text-xs font-medium transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-expanded={false}
            aria-label="Show component library"
            title="Show components"
          >
            <PanelLeftOpen className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium whitespace-nowrap">Show components</span>
          </Button>
        )}
        {/* Loading overlay for initial load only - check if we have nodes in either mode to avoid showing during mode switches */}
        {isLoading && designNodes.length === 0 && executionNodes.length === 0 && !isNewWorkflow && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
            <svg className="animate-spin h-8 w-8 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            <p className="mt-3 text-sm text-muted-foreground">Loading workflow…</p>
          </div>
        )}
        <aside
          className={cn(
            'relative h-full border-r bg-background overflow-hidden z-10',
            isLibraryVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
          style={{
            width: isLibraryVisible ? 320 : 0,
            transition: 'width 200ms ease-in-out, opacity 200ms ease-in-out',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              width: 320,
              transform: isLibraryVisible ? 'translateX(0)' : 'translateX(-320px)',
              transition: 'transform 200ms ease-in-out',
            }}
          >
            {/* Toggle button - positioned inside the panel */}
            {isLibraryVisible && (
              <Button
                type="button"
                variant="ghost"
                onClick={toggleLibrary}
                className="absolute z-50 top-4 right-4 h-7 w-7 flex items-center justify-center rounded-md text-xs font-medium transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-expanded={true}
                aria-label="Hide component library"
                title="Hide components"
              >
                <PanelLeftClose className="h-4 w-4 flex-shrink-0" />
              </Button>
            )}
            <div
              className={cn(
                'absolute inset-0',
                showLibraryContent ? 'opacity-100' : 'opacity-0 pointer-events-none select-none'
              )}
              style={{
                transition: 'opacity 200ms ease-in-out',
              }}
            >
              <Sidebar />
            </div>
          </div>
        </aside>

        <main
          className="flex-1 relative flex"
          style={{
            transition: isInspectorResizing ? 'none' : 'all 200ms ease-in-out',
          }}
        >
          <div className="flex-1 h-full relative">
            {mode === 'design' && workflowId && !schedulePanelExpanded && (
              <div
                className={cn(
                  'absolute right-2 top-2 z-40 flex justify-end w-full transition-opacity duration-100 ease-out',
                  hasSelectedNode ? 'opacity-0 pointer-events-none' : 'opacity-100'
                )}
              >
                <WorkflowSchedulesSummaryBar
                  schedules={workflowSchedules}
                  isLoading={workflowSchedulesLoading}
                  error={workflowSchedulesError}
                  onCreate={() => openScheduleDrawer('create')}
                  onExpand={() => setSchedulePanelExpanded(true)}
                  onViewAll={navigateToSchedules}
                />
              </div>
            )}
            <Canvas
              className="flex-1 h-full relative"
              nodes={nodes}
              edges={edges}
              setNodes={setNodes}
              setEdges={setEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              workflowId={workflowId}
              workflowSchedules={workflowSchedules}
              schedulesLoading={workflowSchedulesLoading}
              scheduleError={workflowSchedulesError}
              onScheduleCreate={() => openScheduleDrawer('create')}
              onScheduleEdit={(schedule) => openScheduleDrawer('edit', schedule)}
              onScheduleAction={handleScheduleAction}
              onScheduleDelete={handleScheduleDelete}
              onViewSchedules={navigateToSchedules}
              onOpenScheduleSidebar={() => {
                // Close config panel when opening schedule sidebar
                setSchedulePanelExpanded(true)
              }}
              onCloseScheduleSidebar={() => setSchedulePanelExpanded(false)}
              onClearNodeSelection={() => {
                // Clear selected node to close config panel when schedule sidebar opens
                // This callback will be called from Canvas when schedule sidebar opens
              }}
              onNodeSelectionChange={(node) => {
                setHasSelectedNode(!!node)
                // Close schedule sidebar when node is selected (config panel opens)
                if (node) {
                  setSchedulePanelExpanded(false)
                }
              }}
            />
          </div>
          {mode === 'design' && workflowId && (
            <aside
              className={cn(
                'overflow-hidden border-l bg-background transition-all duration-150 ease-out',
                schedulePanelExpanded ? 'opacity-100 w-[432px]' : 'opacity-0 w-0 pointer-events-none'
              )}
              style={{
                transition: 'width 150ms ease-out, opacity 150ms ease-out',
              }}
            >
              {schedulePanelExpanded && (
                <WorkflowSchedulesSidebar
                  schedules={workflowSchedules}
                  isLoading={workflowSchedulesLoading}
                  error={workflowSchedulesError}
                  onClose={() => setSchedulePanelExpanded(false)}
                  onCreate={() => openScheduleDrawer('create')}
                  onManage={navigateToSchedules}
                  onEdit={(schedule) => openScheduleDrawer('edit', schedule)}
                  onAction={handleScheduleAction}
                  onDelete={handleScheduleDelete}
                />
              )}
            </aside>
          )}
          <aside
            className={cn(
              'relative h-full border-l bg-background overflow-hidden',
              isInspectorVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            style={{
              width: isInspectorVisible ? inspectorWidth : 0,
              transition: isInspectorResizing
                ? 'opacity 200ms ease-in-out'
                : 'width 200ms ease-in-out, opacity 200ms ease-in-out',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                width: inspectorWidth,
              }}
            >
              <div
                className="absolute top-0 left-0 h-full w-2 cursor-col-resize border-l border-transparent hover:border-primary/40 z-10"
                onMouseDown={handleInspectorResizeStart}
              />
              <div className="flex h-full min-h-0 pl-2 overflow-hidden">
                <ExecutionInspector onRerunRun={handleRerunFromTimeline} />
              </div>
            </div>
          </aside>
        </main>
      </div>

      {/* Bottom panel removed in favor of contextual inspectors */}

      {workflowId && (
        <ScheduleEditorDrawer
          open={scheduleEditorOpen}
          mode={scheduleEditorMode}
          schedule={editingSchedule}
          defaultWorkflowId={workflowId}
          workflowOptions={scheduleWorkflowOptions}
          onClose={() => setScheduleEditorOpen(false)}
          onSaved={handleScheduleSaved}
        />
      )}

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

interface WorkflowSchedulesSummaryBarProps {
  schedules: WorkflowSchedule[]
  isLoading: boolean
  error?: string | null
  onCreate: () => void
  onExpand: () => void
  onViewAll: () => void
}

function WorkflowSchedulesSummaryBar({
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
    <div className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-background/95 px-4 py-2 ring-1 ring-border/60">
      <div className="space-y-0.5">
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
            <span>No schedules configured</span>
          ) : (
            <>
              {countActive > 0 && (
                <span>{countActive} active</span>
              )}
              {countPaused > 0 && (
                <span className="ml-2">{countPaused} paused</span>
              )}
              {countError > 0 && (
                <span className="ml-2 text-destructive">{countError} error</span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={onCreate}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 px-3 text-xs"
          onClick={onExpand}
        >
          Manage
        </Button>
        <div className="relative group">
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

interface WorkflowSchedulesSidebarProps {
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

function WorkflowSchedulesSidebar({
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
      {/* Header - matching ConfigPanel design */}
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

      {/* Action buttons */}
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
              <div
                key={schedule.id}
                className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2"
              >
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
