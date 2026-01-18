import { useCallback, useRef } from 'react'
import type { Node as ReactFlowNode, Edge as ReactFlowEdge, NodeChange } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'
import { useWorkflowHistoryStore, getTemporalState, useTemporalStore } from '@/store/workflowHistoryStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useWorkflowStore } from '@/store/workflowStore'
import type { GraphController } from './useWorkflowGraphControllers'

interface UseWorkflowHistoryOptions {
  /** The design graph controller from useWorkflowGraphControllers */
  designGraph: GraphController
  /** Callback when undo/redo changes the graph */
  onHistoryChange?: () => void
}

interface UseWorkflowHistoryReturn {
  /** Undo the last change */
  undo: () => void
  /** Redo the last undone change */
  redo: () => void
  /** Whether undo is available */
  canUndo: boolean
  /** Whether redo is available */
  canRedo: boolean
  /** Number of past states available for undo */
  historyLength: number
  /** Number of future states available for redo */
  futureLength: number
  /** Capture the current state as an undoable snapshot */
  captureSnapshot: (nodes?: ReactFlowNode<FrontendNodeData>[], edges?: ReactFlowEdge[]) => void
  /** Clear all history (e.g., when loading a new workflow) */
  clearHistory: () => void
  /** Initialize history with the given state */
  initializeHistory: (nodes: ReactFlowNode<FrontendNodeData>[], edges: ReactFlowEdge[]) => void
}

/**
 * Hook for managing undo/redo functionality in the workflow builder.
 * 
 * This hook:
 * - Tracks changes to the design graph and records snapshots
 * - Provides undo/redo functions that restore previous states
 * - Debounces position changes to avoid flooding history during drag
 * - Only operates in design mode
 * 
 * @example
 * ```tsx
 * const { undo, redo, canUndo, canRedo, captureSnapshot } = useWorkflowHistory({
 *   designGraph,
 *   onHistoryChange: markDirty,
 * })
 * 
 * // Before making a change, capture the current state
 * captureSnapshot()
 * // Then make the change
 * setNodes([...])
 * ```
 */
export const useWorkflowHistory = ({
  designGraph,
  onHistoryChange,
}: UseWorkflowHistoryOptions): UseWorkflowHistoryReturn => {
  const mode = useWorkflowUiStore((state) => state.mode)
  const { markDirty } = useWorkflowStore()
  
  // Track the last captured state to avoid duplicates
  const lastCapturedSignatureRef = useRef<string | null>(null)
  
  // Track if we're in the middle of applying undo/redo
  const isApplyingHistoryRef = useRef(false)

  // Debouncing refs for snapshot capture
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStateRef = useRef<{ nodes?: ReactFlowNode<FrontendNodeData>[]; edges?: ReactFlowEdge[] }>({})

  /**
   * Compute a signature for the current state to detect duplicates
   */
  const computeSignature = useCallback((
    nodes: ReactFlowNode<FrontendNodeData>[],
    edges: ReactFlowEdge[]
  ): string => {
    const normalizedNodes = nodes
      .map((node) => ({
        id: node.id,
        position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        data: {
          label: node.data?.label,
          componentId: node.data?.componentId,
          inputs: node.data?.inputs,
          config: node.data?.config,
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    const normalizedEdges = edges
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    return JSON.stringify({ nodes: normalizedNodes, edges: normalizedEdges })
  }, [])

  /**
   * Capture the current graph state as an undoable snapshot
   */
  const captureSnapshot = useCallback((
    nodesOverride?: ReactFlowNode<FrontendNodeData>[],
    edgesOverride?: ReactFlowEdge[]
  ) => {
    if (mode !== 'design' || isApplyingHistoryRef.current) {
      return
    }

    // Update pending state with new overrides if provided
    if (nodesOverride) pendingStateRef.current.nodes = nodesOverride
    if (edgesOverride) pendingStateRef.current.edges = edgesOverride

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      // Resolve final state: Override (via pending) -> Ref
      // Note: We use the accumulated pending state as the source of truth for "next" state
      const nodes = pendingStateRef.current.nodes ?? designGraph.nodesRef.current
      const edges = pendingStateRef.current.edges ?? designGraph.edgesRef.current

      // Reset pending state
      pendingStateRef.current = {}
      debounceRef.current = null

      const signature = computeSignature(nodes, edges)
      
      // Skip if this state is identical to the last captured
      if (signature === lastCapturedSignatureRef.current) {
        return
      }

      lastCapturedSignatureRef.current = signature
      useWorkflowHistoryStore.getState().applyChange(nodes, edges)
    }, 50)
  }, [mode, designGraph, computeSignature])

  /**
   * Initialize history with a starting state (e.g., when loading a workflow)
   */
  const initializeHistory = useCallback((
    nodes: ReactFlowNode<FrontendNodeData>[],
    edges: ReactFlowEdge[]
  ) => {
    // Set initial state first
    useWorkflowHistoryStore.getState().applyChange(nodes, edges)
    
    // Then clear history to ensure this is the baseline (no undoable empty state)
    getTemporalState().clear()
    
    lastCapturedSignatureRef.current = computeSignature(nodes, edges)
  }, [computeSignature])

  /**
   * Clear all history
   */
  const clearHistory = useCallback(() => {
    getTemporalState().clear()
    lastCapturedSignatureRef.current = null
  }, [])

  /**
   * Undo the last change
   */
  const undo = useCallback(() => {
    if (mode !== 'design') {
      return
    }

    const temporal = getTemporalState()
    const pastStates = temporal.pastStates
    
    if (pastStates.length === 0) {
      return
    }

    isApplyingHistoryRef.current = true

    try {
      temporal.undo()
      
      // Get the new current state from the history store
      const { nodes, edges } = useWorkflowHistoryStore.getState()
      
      // Apply to the design graph
      designGraph.setNodes(nodes)
      designGraph.setEdges(edges)
      
      // Update the signature
      lastCapturedSignatureRef.current = computeSignature(nodes, edges)
      
      // Mark as dirty (undo changes state from saved)
      markDirty()
      onHistoryChange?.()
    } finally {
      isApplyingHistoryRef.current = false
    }
  }, [mode, designGraph, computeSignature, markDirty, onHistoryChange])

  /**
   * Redo the last undone change
   */
  const redo = useCallback(() => {
    if (mode !== 'design') {
      return
    }

    const temporal = getTemporalState()
    const futureStates = temporal.futureStates
    
    if (futureStates.length === 0) {
      return
    }

    isApplyingHistoryRef.current = true

    try {
      temporal.redo()
      
      // Get the new current state from the history store
      const { nodes, edges } = useWorkflowHistoryStore.getState()
      
      // Apply to the design graph
      designGraph.setNodes(nodes)
      designGraph.setEdges(edges)
      
      // Update the signature
      lastCapturedSignatureRef.current = computeSignature(nodes, edges)
      
      // Mark as dirty
      markDirty()
      onHistoryChange?.()
    } finally {
      isApplyingHistoryRef.current = false
    }
  }, [mode, designGraph, computeSignature, markDirty, onHistoryChange])

  // Subscribe to temporal state for reactivity
  const pastStates = useTemporalStore((state) => state.pastStates)
  const futureStates = useTemporalStore((state) => state.futureStates)

  return {
    undo,
    redo,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
    historyLength: pastStates.length,
    futureLength: futureStates.length,
    captureSnapshot,
    clearHistory,
    initializeHistory,
  }
}

/**
 * Determine if a set of node changes contains position-only changes
 * (i.e., the user is just dragging nodes around)
 */
export const isPositionOnlyChange = (changes: NodeChange[]): boolean => {
  return changes.every((change) => 
    change.type === 'position' || change.type === 'select' || change.type === 'dimensions'
  )
}

/**
 * Check if a position change has finished (user stopped dragging)
 */
export const isPositionChangeComplete = (changes: NodeChange[]): boolean => {
  return changes.some((change) => 
    change.type === 'position' && 'dragging' in change && change.dragging === false
  )
}

/**
 * Check if any changes add or remove nodes
 */
export const hasStructuralChange = (changes: NodeChange[]): boolean => {
  return changes.some((change) => 
    change.type === 'add' || change.type === 'remove'
  )
}
