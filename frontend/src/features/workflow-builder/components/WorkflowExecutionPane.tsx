import type { ReactNode, SetStateAction } from 'react'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import { Canvas } from '@/components/workflow/Canvas'
import type { FrontendNodeData } from '@/schemas/node'

type SetNodesFn = (setter: SetStateAction<ReactFlowNode<FrontendNodeData>[]>) => void
type SetEdgesFn = (setter: SetStateAction<ReactFlowEdge[]>) => void

interface WorkflowExecutionPaneProps {
  workflowId: string | null | undefined
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
  setNodes: SetNodesFn
  setEdges: SetEdgesFn
  onNodesChange: (changes: any[]) => void
  onEdgesChange: (changes: any[]) => void
  overlay?: ReactNode
}

export function WorkflowExecutionPane({
  workflowId,
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  overlay,
}: WorkflowExecutionPaneProps) {
  return (
    <div className="flex-1 h-full relative">
      {overlay}
      <Canvas
        className="flex-1 h-full relative"
        nodes={nodes}
        edges={edges}
        setNodes={setNodes}
        setEdges={setEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        workflowId={workflowId}
        onClearNodeSelection={() => undefined}
        onNodeSelectionChange={() => undefined}
      />
    </div>
  )
}
