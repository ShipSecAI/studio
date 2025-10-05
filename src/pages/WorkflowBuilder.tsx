import { useParams, useNavigate } from 'react-router-dom'
import { ReactFlowProvider, useReactFlow } from 'reactflow'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomPanel } from '@/components/layout/BottomPanel'
import { Canvas } from '@/components/workflow/Canvas'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { api } from '@/services/api'
import {
  serializeWorkflowForCreate,
  serializeWorkflowForUpdate,
} from '@/utils/workflowSerializer'

function WorkflowBuilderContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNewWorkflow = id === 'new'
  const { mockExecution } = useExecutionStore()
  const { metadata, setWorkflowId, markClean } = useWorkflowStore()
  const { getNodes, getEdges } = useReactFlow()

  const handleRun = () => {
    // Get all node IDs for mock execution
    const nodes = getNodes()
    const nodeIds = nodes.map((n) => n.id)

    if (nodeIds.length === 0) {
      alert('Add some nodes to the workflow first!')
      return
    }

    // Use mock execution (will be replaced with actual API call)
    mockExecution(id || 'new', nodeIds)
  }

  const handleSave = async () => {
    try {
      const nodes = getNodes()
      const edges = getEdges()

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
      alert(`Failed to save workflow: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopBar
        workflowId={id}
        isNew={isNewWorkflow}
        onRun={handleRun}
        onSave={handleSave}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <main className="flex-1 relative">
          <Canvas className="absolute inset-0" />
        </main>
      </div>

      <BottomPanel />
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