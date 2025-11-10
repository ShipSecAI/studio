import { useCallback, useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type NodeMouseHandler,
  type NodeChange,
  type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { WorkflowNode } from './WorkflowNode'
import { ConfigPanel } from './ConfigPanel'
import { DataFlowEdge } from '../timeline/DataFlowEdge'
import { validateConnection } from '@/utils/connectionValidation'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { track, Events } from '@/features/analytics/events'
import { useExecutionTimelineStore } from '@/store/executionTimelineStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import type { NodeData } from '@/schemas/node'
import { useToast } from '@/components/ui/use-toast'

const nodeTypes = {
  workflow: WorkflowNode,
}

const edgeTypes = {
  dataFlow: DataFlowEdge,
  default: DataFlowEdge, // Default to our enhanced edge
}

const MAX_DELETE_HISTORY = 10

interface DeleteHistoryEntry {
  nodes: Node<NodeData>[]
  edges: Edge[]
}

interface CanvasProps {
  className?: string
  nodes: Node<NodeData>[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<Node<NodeData>[]>>
  setEdges: Dispatch<SetStateAction<Edge[]>>
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
}

export function Canvas({
  className,
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
}: CanvasProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null)
  const { getComponent } = useComponentStore()
  const { nodeStates } = useExecutionStore()
  const { markDirty } = useWorkflowStore()
  const { dataFlows, selectedNodeId, selectNode, selectEvent } = useExecutionTimelineStore()
  const { mode } = useWorkflowUiStore()
  const { toast } = useToast()
  const applyEdgesChange = onEdgesChange
  const deleteHistoryRef = useRef<DeleteHistoryEntry[]>([])

  useEffect(() => {
    if (mode === 'execution') {
      setSelectedNode(null)
    }
    if (mode === 'design') {
      useExecutionTimelineStore.setState({ selectedNodeId: null, selectedEventId: null })
    }
  }, [mode])

  // Enhanced edge change handler that also updates input mappings
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    // Handle edge removals by cleaning up input mappings
    if (mode !== 'design') {
      applyEdgesChange(changes)
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
          if (edgeToRemove && edgeToRemove.targetHandle && (node.data.inputs as Record<string, unknown>)?.[edgeToRemove.targetHandle]) {
            const targetHandle = edgeToRemove.targetHandle
            const inputs = node.data.inputs || {}
            const { [targetHandle]: removed, ...remainingInputs } = inputs as Record<string, unknown>
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
    applyEdgesChange(changes)
  }, [edges, setNodes, applyEdgesChange, mode])

  // Sync execution node states to canvas nodes
  useEffect(() => {
    if (mode !== 'execution') {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.data.status && node.data.status !== 'idle') {
            return {
              ...node,
              data: {
                ...node.data,
                status: 'idle',
              },
            }
          }
          return node
        })
      )
      return
    }

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
  }, [mode, nodeStates, setNodes])

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (mode !== 'design') {
        return
      }
      const validation = validateConnection(params, nodes, edges, getComponent)

      if (!validation.isValid) {
        console.warn('Invalid connection:', validation.error)
        toast({
          variant: 'destructive',
          title: 'Invalid connection',
          description: validation.error,
        })
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
                      ...(node.data.inputs as Record<string, unknown>),
                      [targetHandle]: {
                        source: params.source,
                        output: params.sourceHandle,
                      },
                    } as Record<string, unknown>,
                  },
                }
              : node
          )
        )
      }

      // Mark workflow as dirty
      markDirty()
    },
    [setEdges, setNodes, nodes, edges, getComponent, markDirty, mode, toast]
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

      const initialParameters: Record<string, unknown> = {}

      if (Array.isArray(component.parameters)) {
        component.parameters.forEach((parameter) => {
          if (parameter.default !== undefined) {
            const defaultValue = parameter.default
            if (defaultValue !== null && typeof defaultValue === 'object') {
              try {
                initialParameters[parameter.id] = JSON.parse(JSON.stringify(defaultValue))
              } catch {
                initialParameters[parameter.id] = defaultValue
              }
            } else {
              initialParameters[parameter.id] = defaultValue
            }
          }
        })
      }

      if ((component.slug ?? component.id) === 'manual-trigger') {
        initialParameters.runtimeInputs = [
          {
            id: 'input1',
            label: 'Input 1',
            type: 'array',
            required: true,
            description: '',
          },
        ]
      }

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
          parameters: initialParameters,
          inputs: {},
          status: 'idle',
        },
      }

      setNodes((nds) => nds.concat(newNode))

      // Analytics: node added
      try {
        const workflowId = useWorkflowStore.getState().metadata.id
        track(Events.NodeAdded, {
          workflow_id: workflowId ?? undefined,
          component_slug: String(component.slug ?? component.id),
        })
      } catch {}

      // Mark workflow as dirty
      markDirty()
    },
    [reactFlowInstance, setNodes, getComponent, markDirty, mode]
  )


  // Handle node click for config panel
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    if (mode === 'execution') {
      event.preventDefault()
      event.stopPropagation()

      selectNode(node.id)
      selectEvent(null) // Just select the node, don't seek to events

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

      const target = event.target as HTMLElement | null
      if (target) {
        const closestFormElement = target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
        const isFormElement =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.getAttribute('contenteditable') === 'true' ||
          Boolean(closestFormElement)

        if (isFormElement) {
          return
        }
      }

      // Close config panel on Escape
      if (event.key === 'Escape') {
        setSelectedNode(null)
        return
      }

      const isUndoShortcut =
        (event.key === 'z' || event.key === 'Z') &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey

      if (isUndoShortcut) {
        event.preventDefault()
        const lastDeletion = deleteHistoryRef.current.pop()
        if (!lastDeletion) {
          return
        }

        if (lastDeletion.nodes.length > 0) {
          setNodes((nds) => {
            const existingIds = new Set(nds.map((node) => node.id))
            const nodesToRestore = lastDeletion.nodes
              .filter((node) => !existingIds.has(node.id))
              .map((node) => ({ ...node, selected: false }))

            if (nodesToRestore.length === 0) {
              return nds
            }

            return nds.concat(nodesToRestore)
          })
        }

        if (lastDeletion.edges.length > 0) {
          setEdges((eds) => {
            const existingIds = new Set(eds.map((edge) => edge.id))
            const edgesToRestore = lastDeletion.edges
              .filter((edge) => !existingIds.has(edge.id))
              .map((edge) => ({ ...edge, selected: false }))

            if (edgesToRestore.length === 0) {
              return eds
            }

            return eds.concat(edgesToRestore)
          })
        }

        setSelectedNode(null)
        markDirty()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target
        if (target instanceof HTMLElement) {
          const isEditable =
            target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.getAttribute('role') === 'textbox' ||
            target.closest('[contenteditable]:not([contenteditable="false"])')

          if (isEditable) {
            return
          }
        }

        event.preventDefault()
        const selectedNodes = nodes.filter((node) => node.selected)
        const selectedEdges = edges.filter((edge) => edge.selected)
        const nodeIds = new Set(selectedNodes.map((node) => node.id))
        const edgesFromNodes = edges.filter(
          (edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target)
        )
        const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id))
        const dedupedEdges = new Map<string, Edge>()

        edgesFromNodes.forEach((edge) => {
          dedupedEdges.set(edge.id, { ...edge, selected: false })
        })
        selectedEdges.forEach((edge) => {
          dedupedEdges.set(edge.id, { ...edge, selected: false })
        })

        const historyEntryNodes = selectedNodes.map((node) => ({ ...node, selected: false }))
        const historyEntryEdges = Array.from(dedupedEdges.values())

        if (historyEntryNodes.length > 0 || historyEntryEdges.length > 0) {
          const history = deleteHistoryRef.current.slice(-(MAX_DELETE_HISTORY - 1))
          history.push({
            nodes: historyEntryNodes,
            edges: historyEntryEdges,
          })
          deleteHistoryRef.current = history
        }

        if (selectedNodes.length > 0) {
          setNodes((nds) => nds.filter((node) => !nodeIds.has(node.id)))
          setEdges((eds) => eds.filter((edge) =>
            !nodeIds.has(edge.source) && !nodeIds.has(edge.target)
          ))
          setSelectedNode(null)
        }

        if (selectedEdges.length > 0) {
          setEdges((eds) => eds.filter((edge) => !selectedEdgeIds.has(edge.id)))
        }

        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
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
            onEdgesChange={handleEdgesChange}
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
