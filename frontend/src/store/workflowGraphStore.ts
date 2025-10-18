import type { Edge } from 'reactflow'
import { create } from 'zustand'

import type { CanvasNode, WorkflowGraphActions, WorkflowGraphState } from './workflowSlice'

const initialState: WorkflowGraphState = {
  nodes: [],
  edges: [],
}

type WorkflowGraphStore = WorkflowGraphState & WorkflowGraphActions

export const useWorkflowGraphStore = create<WorkflowGraphStore>()((set) => ({
  ...initialState,

  setNodes: (nodes: CanvasNode[]) => {
    set({ nodes })
  },

  setEdges: (edges: Edge[]) => {
    set({ edges })
  },

  importGraph: (graph: WorkflowGraphState) => {
    set(graph)
  },

  resetGraph: () => {
    set(initialState)
  },
}))
