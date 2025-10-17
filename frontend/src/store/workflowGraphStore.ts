import { create } from 'zustand'
import type { Edge } from 'reactflow'
import type { CanvasNode, WorkflowGraphActions, WorkflowGraphState } from './workflowSlice'
import { createSelectors } from './createSelectors'

const initialState: WorkflowGraphState = {
  nodes: [],
  edges: [],
}

type WorkflowGraphStore = WorkflowGraphState & WorkflowGraphActions

const baseStore = create<WorkflowGraphStore>()((set) => ({
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

export const useWorkflowGraphStore = createSelectors(baseStore)
