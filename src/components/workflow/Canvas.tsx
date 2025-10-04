import { useCallback, useState, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  type NodeMouseHandler,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { WorkflowNode } from './WorkflowNode'
import { ConfigPanel } from './ConfigPanel'
import { validateConnection } from '@/utils/connectionValidation'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import type { NodeData } from '@/schemas/node'

const nodeTypes = {
  workflow: WorkflowNode,
}

const initialNodes: Node[] = []
const initialEdges: Edge[] = []

interface CanvasProps {
  className?: string
}

export function Canvas({ className }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null)
  const { getComponent } = useComponentStore()
  const { nodeStates } = useExecutionStore()

  // Sync execution node states to canvas nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        const executionState = nodeStates[node.id]
        if (executionState && executionState !== node.data.status) {
          return {
            ...node,
            data: {
              ...node.data,
              status: executionState,
            },
          }
        }
        return node
      })
    )
  }, [nodeStates, setNodes])

  const onConnect: OnConnect = useCallback(
    (params) => {
      const validation = validateConnection(params, nodes, edges, getComponent)

      if (!validation.isValid) {
        console.warn('Invalid connection:', validation.error)
        // TODO: Show toast notification with validation.error
        alert(`Connection failed: ${validation.error}`)
        return
      }

      setEdges((eds) => addEdge({
        ...params,
        type: 'smoothstep',
        animated: false,
      }, eds))
    },
    [setEdges, nodes, edges, getComponent]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const componentSlug = event.dataTransfer.getData('application/reactflow')

      if (typeof componentSlug === 'undefined' || !componentSlug) {
        return
      }

      const component = getComponent(componentSlug)
      if (!component) {
        console.error('Component not found:', componentSlug)
        return
      }

      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      if (!position) return

      const newNode: Node<NodeData> = {
        id: `${componentSlug}-${Date.now()}`,
        type: 'workflow',
        position,
        data: {
          componentSlug: componentSlug,
          componentVersion: component.version,
          parameters: {},
          status: 'idle',
        },
      }

      setNodes((nds) => nds.concat(newNode))
    },
    [reactFlowInstance, setNodes, getComponent]
  )


  // Handle node click for config panel
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNode(node as Node<NodeData>)
  }, [])

  // Handle pane click to deselect
  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Handle node data update from config panel
  const handleUpdateNode = useCallback((nodeId: string, data: Partial<NodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      )
    )
  }, [setNodes])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Close config panel on Escape
      if (event.key === 'Escape') {
        setSelectedNode(null)
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodes = nodes.filter((node) => node.selected)
        const selectedEdges = edges.filter((edge) => edge.selected)

        if (selectedNodes.length > 0) {
          const nodeIds = selectedNodes.map((node) => node.id)
          setNodes((nds) => nds.filter((node) => !nodeIds.includes(node.id)))
          setEdges((eds) => eds.filter((edge) =>
            !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target)
          ))
          setSelectedNode(null)
        }

        if (selectedEdges.length > 0) {
          const edgeIds = selectedEdges.map((edge) => edge.id)
          setEdges((eds) => eds.filter((edge) => !edgeIds.includes(edge.id)))
        }
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [nodes, edges, setNodes, setEdges])

  return (
    <div className={className}>
      <div className="flex h-full">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background color="#aaa" gap={16} />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              nodeColor={(node) => {
                switch (node.data?.status) {
                  case 'running':
                    return '#f59e0b'
                  case 'success':
                    return '#10b981'
                  case 'error':
                    return '#ef4444'
                  default:
                    return '#6b7280'
                }
              }}
            />
          </ReactFlow>
        </div>

        {/* Config Panel */}
        {selectedNode && (
          <ConfigPanel
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
            onUpdateNode={handleUpdateNode}
          />
        )}
      </div>
    </div>
  )
}