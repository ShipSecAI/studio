import { useParams } from 'react-router-dom'
import { ReactFlowProvider, useReactFlow } from 'reactflow'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomPanel } from '@/components/layout/BottomPanel'
import { Canvas } from '@/components/workflow/Canvas'
import { useExecutionStore } from '@/store/executionStore'

function WorkflowBuilderContent() {
  const { id } = useParams<{ id: string }>()
  const isNewWorkflow = id === 'new'
  const { mockExecution } = useExecutionStore()
  const { getNodes } = useReactFlow()

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

  const handleSave = () => {
    // TODO: Implement actual save logic
    console.log('Saving workflow...')
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