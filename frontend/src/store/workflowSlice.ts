import type { Edge, Node } from 'reactflow'

import type { NodeData } from '@/schemas/node'

export interface CanvasNode extends Node<NodeData> {
  data: NodeData & {
    componentId?: string
    componentSlug?: string
    status?: string
    inputs?: Record<string, unknown>
    parameters?: Record<string, unknown>
  }
}

export interface WorkflowGraphState {
  nodes: CanvasNode[]
  edges: Edge[]
}

export interface WorkflowGraphActions {
  setNodes: (nodes: CanvasNode[]) => void
  setEdges: (edges: Edge[]) => void
  importGraph: (graph: WorkflowGraphState) => void
  resetGraph: () => void
}
