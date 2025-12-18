import { useEffect, useMemo, useRef } from 'react'
import {
  useNodesState,
  useEdgesState,
  type NodeChange,
  type EdgeChange,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'

export const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint'
export const ENTRY_COMPONENT_SLUG = 'entry-point'

export interface GraphSnapshot {
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
}

export interface GraphController {
  nodes: ReactFlowNode<FrontendNodeData>[]
  edges: ReactFlowEdge[]
  setNodes: ReturnType<typeof useNodesState<FrontendNodeData>>[1]
  setEdges: ReturnType<typeof useEdgesState>[1]
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  nodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>
  edgesRef: React.MutableRefObject<ReactFlowEdge[]>
  preservedStateRef: React.MutableRefObject<GraphSnapshot | null>
  savedSnapshotRef: React.MutableRefObject<GraphSnapshot | null>
}

export interface WorkflowGraphControllers {
  design: GraphController
  execution: GraphController
}

type ToastFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' | 'warning' | 'success' }) => void

const isEntryPointNode = (node?: ReactFlowNode<FrontendNodeData>) => {
  if (!node) return false
  const componentRef = node.data?.componentId ?? node.data?.componentSlug
  return componentRef === ENTRY_COMPONENT_ID || componentRef === ENTRY_COMPONENT_SLUG
}

export const cloneNodes = (nodes: ReactFlowNode<FrontendNodeData>[]) =>
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

export const cloneEdges = (edges: ReactFlowEdge[]) => edges.map((edge) => ({ ...edge }))

const createNodesChangeHandler = ({
  nodesRef,
  onNodesChangeBase,
  toast,
  shouldMarkDirty,
}: {
  nodesRef: React.MutableRefObject<ReactFlowNode<FrontendNodeData>[]>
  onNodesChangeBase: (changes: NodeChange[]) => void
  toast: ToastFn
  shouldMarkDirty?: () => void
}) =>
  (changes: NodeChange[]) => {
    if (changes.length === 0) {
      return
    }

    const currentNodes = nodesRef.current
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
    shouldMarkDirty?.()
  }

const createEdgesChangeHandler = ({
  onEdgesChangeBase,
  shouldMarkDirty,
}: {
  onEdgesChangeBase: (changes: EdgeChange[]) => void
  shouldMarkDirty?: () => void
}) =>
  (changes: EdgeChange[]) => {
    onEdgesChangeBase(changes)
    if (changes.length > 0) {
      shouldMarkDirty?.()
    }
  }

export const useWorkflowGraphControllers = ({
  toast,
  onDesignGraphDirty,
}: {
  toast: ToastFn
  onDesignGraphDirty?: () => void
}): WorkflowGraphControllers => {
  const [designNodes, setDesignNodes, onDesignNodesChangeBase] = useNodesState<FrontendNodeData>([])
  const [designEdges, setDesignEdges, onDesignEdgesChangeBase] = useEdgesState([])
  const [executionNodes, setExecutionNodes, onExecutionNodesChangeBase] = useNodesState<FrontendNodeData>([])
  const [executionEdges, setExecutionEdges, onExecutionEdgesChangeBase] = useEdgesState([])

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

  const designNodesChange = useMemo(
    () =>
      createNodesChangeHandler({
        nodesRef: designNodesRef,
        onNodesChangeBase: onDesignNodesChangeBase,
        toast,
        shouldMarkDirty: onDesignGraphDirty,
      }),
    [onDesignNodesChangeBase, toast, onDesignGraphDirty],
  )

  const executionNodesChange = useMemo(
    () =>
      createNodesChangeHandler({
        nodesRef: executionNodesRef,
        onNodesChangeBase: onExecutionNodesChangeBase,
        toast,
      }),
    [onExecutionNodesChangeBase, toast],
  )

  const designEdgesChange = useMemo(
    () =>
      createEdgesChangeHandler({
        onEdgesChangeBase: onDesignEdgesChangeBase,
        shouldMarkDirty: onDesignGraphDirty,
      }),
    [onDesignEdgesChangeBase, onDesignGraphDirty],
  )

  const executionEdgesChange = useMemo(
    () =>
      createEdgesChangeHandler({
        onEdgesChangeBase: onExecutionEdgesChangeBase,
      }),
    [onExecutionEdgesChangeBase],
  )

  const designPreservedRef = useRef<GraphSnapshot | null>(null)
  const designSavedSnapshotRef = useRef<GraphSnapshot | null>(null)
  const executionPreservedRef = useRef<GraphSnapshot | null>(null)
  const executionSavedSnapshotRef = useRef<GraphSnapshot | null>(null)

  return {
    design: {
      nodes: designNodes,
      edges: designEdges,
      setNodes: setDesignNodes,
      setEdges: setDesignEdges,
      onNodesChange: designNodesChange,
      onEdgesChange: designEdgesChange,
      nodesRef: designNodesRef,
      edgesRef: designEdgesRef,
      preservedStateRef: designPreservedRef,
      savedSnapshotRef: designSavedSnapshotRef,
    },
    execution: {
      nodes: executionNodes,
      edges: executionEdges,
      setNodes: setExecutionNodes,
      setEdges: setExecutionEdges,
      onNodesChange: executionNodesChange,
      onEdgesChange: executionEdgesChange,
      nodesRef: executionNodesRef,
      edgesRef: executionEdgesRef,
      preservedStateRef: executionPreservedRef,
      savedSnapshotRef: executionSavedSnapshotRef,
    },
  }
}
