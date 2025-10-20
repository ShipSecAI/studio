import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
} from 'reactflow'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Canvas } from '@/components/workflow/Canvas'
import { ReviewInspector } from '@/components/timeline/ReviewInspector'
import { ReviewRunBanner } from '@/components/timeline/ReviewRunBanner'
import { RunWorkflowDialog } from '@/components/workflow/RunWorkflowDialog'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useComponentStore } from '@/store/componentStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { api, API_BASE_URL } from '@/services/api'
import { cn } from '@/lib/utils'
import {
  serializeWorkflowForCreate,
  serializeWorkflowForUpdate,
  deserializeNodes,
  deserializeEdges,
} from '@/utils/workflowSerializer'
import type { NodeData } from '@/schemas/node'

function WorkflowBuilderContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNewWorkflow = id === 'new'
  const { metadata, setMetadata, setWorkflowId, markClean, resetWorkflow } = useWorkflowStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const { getComponent } = useComponentStore()
  const [isLoading, setIsLoading] = useState(false)
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runtimeInputs, setRuntimeInputs] = useState<any[]>([])
  const { mode, libraryOpen, inspectorWidth, setInspectorWidth } = useWorkflowUiStore()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const inspectorResizingRef = useRef(false)

  // Load workflow on mount (if not new)
  useEffect(() => {
    const loadWorkflow = async () => {
      if (isNewWorkflow) {
        // Reset store for new workflow
        resetWorkflow()
        setNodes([])
        setEdges([])
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
          description: workflow.description,
        })

        // Deserialize and set nodes/edges
        const workflowEdges = deserializeEdges(workflow.edges)
        const workflowNodes = deserializeNodes(workflow.nodes, workflow.edges)

        setNodes(workflowNodes)
        setEdges(workflowEdges)

        // Mark as clean (no unsaved changes)
        markClean()
      } catch (error) {
        console.error('Failed to load workflow:', error)

        // Check if it's a network error (backend not available)
        const isNetworkError = error instanceof Error &&
          (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

        if (isNetworkError) {
          alert(`Cannot connect to backend server. Please ensure the backend is running at ${API_BASE_URL}`)
        } else {
          alert(`Failed to load workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        navigate('/')
      } finally {
        setIsLoading(false)
      }
    }

    loadWorkflow()
  }, [id, isNewWorkflow, navigate, setMetadata, setNodes, setEdges, resetWorkflow, markClean])

  const handleRun = async () => {
    if (nodes.length === 0) {
      alert('Add some nodes to the workflow first!')
      return
    }

    // Ensure workflow is saved before running
    const workflowId = metadata.id
    if (!workflowId || isNewWorkflow) {
      alert('Please save the workflow before running it.')
      return
    }

    // Check if workflow has a Manual Trigger with runtime inputs
    const triggerNode = nodes.find(node => {
      const nodeData = node.data as any
      const componentRef = nodeData.componentId ?? nodeData.componentSlug
      const component = getComponent(componentRef)
      return component?.slug === 'manual-trigger'
    })

    if (triggerNode) {
      const nodeData = triggerNode.data as any
      const runtimeInputsParam = nodeData.parameters?.runtimeInputs

      if (runtimeInputsParam) {
        try {
          const parsedInputs = typeof runtimeInputsParam === 'string'
            ? JSON.parse(runtimeInputsParam)
            : runtimeInputsParam

          if (Array.isArray(parsedInputs) && parsedInputs.length > 0) {
            // Show dialog to collect runtime inputs
            setRuntimeInputs(parsedInputs)
            setRunDialogOpen(true)
            return
          }
        } catch (error) {
          console.error('Failed to parse runtime inputs:', error)
        }
      }
    }

    // No runtime inputs needed, run directly
    await executeWorkflow()
  }

  const executeWorkflow = async (runtimeData?: Record<string, unknown>) => {
    const workflowId = metadata.id
    if (!workflowId) return

    setIsLoading(true)
    try {
      // First, commit the workflow (compile DSL)
      await api.workflows.commit(workflowId)
      
      // Then run it with runtime inputs if provided
      const runId = await useExecutionStore.getState().startExecution(
        workflowId,
        runtimeData
      )

      if (runId) {
        alert(`Workflow started! Execution ID: ${runId}\n\nCheck the bottom panel for execution status.`)
      } else {
        alert('Workflow started but no run ID returned')
      }
    } catch (error) {
      console.error('Failed to run workflow:', error)
      alert(`Failed to run workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      if (nodes.length === 0) {
        alert('Add some nodes to the workflow before saving!')
        return
      }

      // Determine if this is a create or update operation
      const workflowId = metadata.id

      if (!workflowId || isNewWorkflow) {
        // Create new workflow
        const payload = serializeWorkflowForCreate(
          metadata.name,
          metadata.description,
          nodes,
          edges
        )

        const savedWorkflow = await api.workflows.create(payload)

        // Update store with new workflow ID
        setWorkflowId(savedWorkflow.id)
        markClean()

        // Navigate to the new workflow URL
        navigate(`/workflows/${savedWorkflow.id}`, { replace: true })

        alert('Workflow created successfully!')
      } else {
        // Update existing workflow
        const payload = serializeWorkflowForUpdate(
          workflowId,
          metadata.name,
          metadata.description,
          nodes,
          edges
        )

        await api.workflows.update(workflowId, payload)
        markClean()

        alert('Workflow saved successfully!')
      }
    } catch (error) {
      console.error('Failed to save workflow:', error)

      // Check if it's a network error (backend not available)
      const isNetworkError = error instanceof Error &&
        (error.message.includes('Network Error') || error.message.includes('ECONNREFUSED'))

      if (isNetworkError) {
        alert(`Cannot connect to backend server. Please ensure the backend is running at ${API_BASE_URL}\n\nYour workflow is still available in the browser.`)
      } else {
        alert(`Failed to save workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  const handleInspectorResizeStart = useCallback((event: React.MouseEvent) => {
    if (mode !== 'review') {
      return
    }
    inspectorResizingRef.current = true
    document.body.classList.add('select-none')
    event.preventDefault()
  }, [mode])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!inspectorResizingRef.current || mode !== 'review') {
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

  const isLibraryVisible = libraryOpen && mode === 'design'
  const isInspectorVisible = mode === 'review'

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
      />

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
              isLibraryVisible ? 'opacity-100' : 'opacity-0 pointer-events-none select-none'
            )}
          >
            <Sidebar />
          </div>
        </aside>

        <main className="flex-1 relative flex">
          <ReviewRunBanner />
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
                <ReviewInspector />
              </div>
            </aside>
          )}
        </main>
      </div>

      {/* Bottom panel removed in favor of contextual inspectors */}

      <RunWorkflowDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        workflowId={metadata.id || ''}
        runtimeInputs={runtimeInputs}
        onRun={executeWorkflow}
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
