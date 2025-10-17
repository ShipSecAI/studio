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
import { DataFlowEdge } from '../timeline/DataFlowEdge'
import { validateConnection } from '@/utils/connectionValidation'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import type { NodeData } from '@/schemas/node'

const nodeTypes = {
  workflow: WorkflowNode,
}

const edgeTypes = {
  dataFlow: DataFlowEdge,
  default: DataFlowEdge, // Default to our enhanced edge
}

const initialNodes: Node[] = []
const initialEdges: Edge[] = []

interface CanvasProps {
  className?: string
}

export function Canvas({ className }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, originalOnEdgesChange] = useEdgesState(initialEdges)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null)
  const { getComponent } = useComponentStore()
  const { nodeStates } = useExecutionStore()
  const { markDirty } = useWorkflowStore()
  const { selectedRunId, dataFlows, selectedNodeId, selectNode, selectEvent } = useExecutionTimelineStore()
  const { mode } = useWorkflowUiStore()

  useEffect(() => {
    if (mode === 'review') {
      setSelectedNode(null)
    }
    if (mode === 'design') {
      useExecutionTimelineStore.setState({ selectedNodeId: null, selectedEventId: null })
    }
  }, [mode])

  // Enhanced edge change handler that also updates input mappings
  const onEdgesChange = useCallback((changes: any[]) => {
    // Handle edge removals by cleaning up input mappings
    if (mode !== 'design') {
      originalOnEdgesChange(changes)
      return
    }

    const removedEdges = changes
      .filter(change => change.type === 'remove')
      .map(change => edges.find(edge => edge.id === change.id))
      .filter(Boolean)

    if (removedEdges.length > 0) {
      setNodes((nds) =>
        nds.map((node) => {
          const edgeToRemove = removedEdges.find(edge => edge && edge.target === node.id)
          if (edgeToRemove && edgeToRemove.targetHandle && node.data.inputs?.[edgeToRemove.targetHandle]) {
            const targetHandle = edgeToRemove.targetHandle
            const { [targetHandle]: removed, ...remainingInputs } = node.data.inputs
            return {
              ...node,
              data: {
                ...node.data,
                inputs: remainingInputs,
              },
            }
          }
          return node
        })
      )
    }

    // Apply the original edge changes
    originalOnEdgesChange(changes)
  }, [edges, setNodes, originalOnEdgesChange, mode])

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
      if (mode !== 'design') {
        return
      }
      const validation = validateConnection(params, nodes, edges, getComponent)

      if (!validation.isValid) {
        console.warn('Invalid connection:', validation.error)
        // TODO: Show toast notification with validation.error
        alert(`Connection failed: ${validation.error}`)
        return
      }

      // Add the edge with data flow support
      const newEdge = {
        ...params,
        type: 'default', // Use our enhanced DataFlowEdge
        animated: false,
        data: {
          packets: [], // Will be populated by timeline store
          isHighlighted: selectedNodeId === params.source || selectedNodeId === params.target,
        },
      }
      setEdges((eds) => addEdge(newEdge, eds))

      // Update target node's input mapping
      if (params.target && params.targetHandle && params.source && params.sourceHandle) {
        const targetHandle = params.targetHandle
        setNodes((nds) =>
          nds.map((node) =>
            node.id === params.target
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    inputs: {
                      ...node.data.inputs,
                      [targetHandle]: {
                        source: params.source,
                        output: params.sourceHandle,
                      },
                    },
                  },
                }
              : node
          )
        )
      }

      // Mark workflow as dirty
      markDirty()
    },
    [setEdges, setNodes, nodes, edges, getComponent, markDirty, mode]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (mode !== 'design') return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [mode])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      if (mode !== 'design') return

      const componentId = event.dataTransfer.getData('application/reactflow')

      if (typeof componentId === 'undefined' || !componentId) {
        return
      }

      const component = getComponent(componentId)
      if (!component) {
        console.error('Component not found:', componentId)
        return
      }

      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      if (!position) return

      const newNode: Node<NodeData> = {
        id: `${component.slug ?? component.id}-${Date.now()}`,
        type: 'workflow',
        position,
        data: {
          // Backend fields (required)
          label: component.name,
          config: {},
          // Frontend fields
          componentId: component.id,
          componentSlug: component.slug ?? component.id,
          componentVersion: component.version,
          parameters: {},
          inputs: {},
          status: 'idle',
        },
      }

      setNodes((nds) => nds.concat(newNode))

      // Mark workflow as dirty
      markDirty()
    },
    [reactFlowInstance, setNodes, getComponent, markDirty, mode]
  )


  // Handle node click for config panel
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (mode === 'review') {
      event.preventDefault()
      event.stopPropagation()

      selectNode(node.id)

      const { events, seek } = useExecutionTimelineStore.getState()
      const nodeEvents = events.filter((timelineEvent) => timelineEvent.nodeId === node.id)

      if (nodeEvents.length > 0) {
        const latestEvent = nodeEvents[nodeEvents.length - 1]
        selectEvent(latestEvent.id)
        seek(latestEvent.offsetMs)
      } else {
        selectEvent(null)
      }

      return
    }

    setSelectedNode(node as Node<NodeData>)
  }, [mode, selectNode, selectEvent])

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

    // Mark workflow as dirty
    markDirty()
  }, [setNodes, markDirty])

  // Sync selectedNode with the latest node data from nodes array
  useEffect(() => {
    if (selectedNode) {
      const updatedNode = nodes.find(n => n.id === selectedNode.id)
      if (!updatedNode) {
        // Node was deleted, clear selection
        setSelectedNode(null)
      } else if (updatedNode !== selectedNode) {
        setSelectedNode(updatedNode as Node<NodeData>)
      }
    }
  }, [nodes, selectedNode])

  // Update edges with data flow highlighting and packet data
  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          packets: dataFlows.filter(
            packet =>
              packet.sourceNode === edge.source &&
              packet.targetNode === edge.target
          ),
          isHighlighted: selectedNodeId === edge.source || selectedNodeId === edge.target,
        },
      }))
    )
  }, [dataFlows, selectedNodeId, setEdges])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (mode !== 'design') {
        return
      }
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
          markDirty()
        }

        if (selectedEdges.length > 0) {
          const edgeIds = selectedEdges.map((edge) => edge.id)
          setEdges((eds) => eds.filter((edge) => !edgeIds.includes(edge.id)))
          markDirty()
        }
      }
    }

    document.addEventListener('keydown', handleKeyPress)
    return () => document.removeEventListener('keydown', handleKeyPress)
  }, [nodes, edges, setNodes, setEdges, markDirty, mode])

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
            edgeTypes={edgeTypes}
            attributionPosition="bottom-left"
            nodesDraggable={mode === 'design'}
            nodesConnectable={mode === 'design'}
            elementsSelectable
          >
            {/* SVG markers for edges */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 10 3, 0 6"
                    fill="#6b7280"
                  />
                </marker>
              </defs>
            </svg>

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
        {mode === 'design' && selectedNode && (
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
