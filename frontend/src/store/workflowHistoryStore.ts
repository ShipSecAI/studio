import { create } from 'zustand'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { temporal, type TemporalState } from 'zundo'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'

/**
 * Graph state that is tracked for undo/redo
 */
interface GraphState {
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
}

/**
 * Actions for updating graph state
 */
interface GraphActions {
  /**
   * Set nodes directly (used when applying undo/redo or loading)
   */
  setNodes: (nodes: ReactFlowNode<FrontendNodeData>[]) => void
  
  /**
   * Set edges directly (used when applying undo/redo or loading)
   */
  setEdges: (edges: ReactFlowEdge[]) => void
  
  /**
   * Apply a complete graph state change (batched for single undo)
   * This is the primary method for recording undoable changes
   */
  applyChange: (nodes: ReactFlowNode<FrontendNodeData>[], edges: ReactFlowEdge[]) => void
  
  /**
   * Reset the store to initial state
   */
  reset: () => void
}

type WorkflowHistoryStore = GraphState & GraphActions

const initialState: GraphState = {
  nodes: [],
  edges: [],
}

/**
 * Deep clone nodes to ensure immutability
 */
const cloneNodes = (nodes: ReactFlowNode<FrontendNodeData>[]): ReactFlowNode<FrontendNodeData>[] =>
  nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: {
      ...node.data,
      config: node.data?.config ? { ...node.data.config } : { params: {}, inputOverrides: {} },
      inputs: node.data?.inputs ? { ...node.data.inputs } : {},
    },
  }))

/**
 * Deep clone edges to ensure immutability
 */
const cloneEdges = (edges: ReactFlowEdge[]): ReactFlowEdge[] =>
  edges.map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined }))

/**
 * Compute a normalized signature for comparison
 * Used to determine if two states are meaningfully different
 */
const computeStateSignature = (state: GraphState): string => {
  const normalizedNodes = state.nodes
    .map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      data: {
        label: node.data?.label,
        componentId: node.data?.componentId,
        componentSlug: node.data?.componentSlug,
        inputs: node.data?.inputs,
        config: node.data?.config,
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const normalizedEdges = state.edges
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return JSON.stringify({ nodes: normalizedNodes, edges: normalizedEdges })
}

/**
 * Workflow History Store
 * 
 * Manages the undo/redo history for the workflow graph.
 * Uses zundo's temporal middleware to automatically track state changes.
 * 
 * Usage:
 * ```
 * // In your component
 * const { nodes, edges, applyChange } = useWorkflowHistoryStore()
 * const { undo, redo, pastStates, futureStates } = useWorkflowHistoryStore.temporal.getState()
 * 
 * // Record an undoable change
 * applyChange(newNodes, newEdges)
 * 
 * // Undo/Redo
 * undo()
 * redo()
 * 
 * // Check if undo/redo is available
 * const canUndo = pastStates.length > 0
 * const canRedo = futureStates.length > 0
 * ```
 */
export const useWorkflowHistoryStore = create<WorkflowHistoryStore>()(
  temporal(
    (set) => ({
      ...initialState,

      setNodes: (nodes) => set({ nodes: cloneNodes(nodes) }),
      
      setEdges: (edges) => set({ edges: cloneEdges(edges) }),
      
      applyChange: (nodes, edges) => set({ 
        nodes: cloneNodes(nodes), 
        edges: cloneEdges(edges) 
      }),
      
      reset: () => set(initialState),
    }),
    {
      // Maximum number of undo steps to keep
      limit: 50,
      
      // Compare states to avoid storing duplicates
      equality: (pastState, currentState) => {
        return computeStateSignature(pastState) === computeStateSignature(currentState)
      },
      
      // Only track nodes and edges, not the action functions
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }) as WorkflowHistoryStore,
      
      // Called when undo/redo happens - can be used for side effects
      onSave: (_pastState, _currentState) => {
        // Optional: could log or track analytics here
      },
    }
  )
)

/**
 * Hook to access temporal (undo/redo) state reactively
 * Uses useStoreWithEqualityFn from zustand/traditional for proper subscriptions
 * 
 * @example
 * ```tsx
 * const pastStates = useTemporalStore((state) => state.pastStates)
 * const { undo, redo, clear } = useTemporalStore((state) => ({ 
 *   undo: state.undo, 
 *   redo: state.redo, 
 *   clear: state.clear 
 * }))
 * ```
 */
export function useTemporalStore(): TemporalState<GraphState>
export function useTemporalStore<T>(selector: (state: TemporalState<GraphState>) => T): T
export function useTemporalStore<T>(
  selector: (state: TemporalState<GraphState>) => T,
  equality: (a: T, b: T) => boolean,
): T
export function useTemporalStore<T>(
  selector?: (state: TemporalState<GraphState>) => T,
  equality?: (a: T, b: T) => boolean,
) {
  return useStoreWithEqualityFn(
    useWorkflowHistoryStore.temporal,
    selector as (state: TemporalState<GraphState>) => T,
    equality
  )
}

/**
 * Convenience hook for undo/redo actions and state
 * Returns reactive values for canUndo/canRedo
 */
export const useUndoRedo = () => {
  const pastStates = useTemporalStore((state) => state.pastStates)
  const futureStates = useTemporalStore((state) => state.futureStates)
  const undo = useTemporalStore((state) => state.undo)
  const redo = useTemporalStore((state) => state.redo)
  const clear = useTemporalStore((state) => state.clear)
  
  return {
    undo,
    redo,
    clear,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
    historyLength: pastStates.length,
    futureLength: futureStates.length,
  }
}

/**
 * Get the temporal store instance directly (for use outside React components)
 */
export const getTemporalState = () => useWorkflowHistoryStore.temporal.getState()
