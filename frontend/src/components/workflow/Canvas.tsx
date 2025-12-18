import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type OnConnect,
  type NodeMouseHandler,
  type NodeChange,
  type EdgeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { WorkflowNode } from './WorkflowNode'
import { TerminalNode } from './TerminalNode'
import { ConfigPanel } from './ConfigPanel'
import { ValidationDock } from './ValidationDock'
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
import type { WorkflowSchedule } from '@shipsec/shared'
import { cn } from '@/lib/utils'
import { useOptionalWorkflowSchedulesContext } from '@/features/workflow-builder/contexts/WorkflowSchedulesContext'

// Context for entry point actions
interface EntryPointActionsContextValue {
  onOpenScheduleSidebar?: () => void
  onScheduleCreate?: () => void
}

const EntryPointActionsContext = createContext<EntryPointActionsContextValue>({})
export const useEntryPointActions = () => useContext(EntryPointActionsContext)

const MAX_DELETE_HISTORY = 10
const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint'
const ENTRY_COMPONENT_SLUG = 'entry-point'

const isEntryPointComponentRef = (ref?: string | null) =>
  ref === ENTRY_COMPONENT_ID || ref === ENTRY_COMPONENT_SLUG

const isEntryPointNode = (node?: Node<NodeData> | null) => {
  if (!node) return false
  const nodeData = node?.data as NodeData | undefined
  const componentRef = (nodeData?.componentId ?? nodeData?.componentSlug) as string | undefined
  return isEntryPointComponentRef(componentRef)
}

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
  workflowId?: string | null
  workflowSchedules?: WorkflowSchedule[]
  schedulesLoading?: boolean
  scheduleError?: string | null
  onScheduleCreate?: () => void
  onScheduleEdit?: (schedule: WorkflowSchedule) => void
  onScheduleAction?: (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => Promise<void> | void
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void
  onViewSchedules?: () => void
  onOpenScheduleSidebar?: () => void
  onCloseScheduleSidebar?: () => void
  onClearNodeSelection?: () => void
  onNodeSelectionChange?: (node: Node<NodeData> | null) => void
}

export function Canvas({
  className,
  nodes,
  edges,
  setNodes,
  setEdges,
  onNodesChange,
  onEdgesChange,
  workflowId,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
  onOpenScheduleSidebar,
  onCloseScheduleSidebar,
  onClearNodeSelection,
  onNodeSelectionChange,
}: CanvasProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null)
  const { getComponent } = useComponentStore()
  const { nodeStates } = useExecutionStore()
  const { markDirty } = useWorkflowStore()
  const { dataFlows, selectedNodeId, selectNode, selectEvent } = useExecutionTimelineStore()
  const mode = useWorkflowUiStore((state) => state.mode)
  const { toast } = useToast()
  const scheduleContext = useOptionalWorkflowSchedulesContext()
  const resolvedWorkflowSchedules = workflowSchedules ?? scheduleContext?.schedules ?? []
  const resolvedSchedulesLoading = schedulesLoading ?? scheduleContext?.isLoading ?? false
  const resolvedScheduleError = scheduleError ?? scheduleContext?.error ?? null
  const resolvedOnScheduleCreate = onScheduleCreate ?? scheduleContext?.onScheduleCreate
  const resolvedOnScheduleEdit = onScheduleEdit ?? scheduleContext?.onScheduleEdit
  const resolvedOnScheduleAction = onScheduleAction ?? scheduleContext?.onScheduleAction
  const resolvedOnScheduleDelete = onScheduleDelete ?? scheduleContext?.onScheduleDelete
  const resolvedOnViewSchedules = onViewSchedules ?? scheduleContext?.onViewSchedules
  const resolvedOnOpenScheduleSidebar = onOpenScheduleSidebar ?? scheduleContext?.onOpenScheduleSidebar
  const resolvedOnCloseScheduleSidebar = onCloseScheduleSidebar ?? scheduleContext?.onCloseScheduleSidebar
  const applyEdgesChange = onEdgesChange
  const deleteHistoryRef = useRef<DeleteHistoryEntry[]>([])
  const hasUserInteractedRef = useRef(false)
  const prevModeRef = useRef<typeof mode>(mode)
  const prevNodesLengthRef = useRef(nodes.length)
  const prevEdgesLengthRef = useRef(edges.length)
  const [configPanelWidth, setConfigPanelWidth] = useState(432) // Default panel width
  const [canvasOpacity, setCanvasOpacity] = useState(1) // For fade transition

  const nodeTypes = useMemo(
    () => ({
      workflow: WorkflowNode,
      terminal: TerminalNode,
    }),
    []
  )

  const edgeTypes = useMemo(
    () => ({
      dataFlow: DataFlowEdge,
      default: DataFlowEdge, // Default to our enhanced edge
    }),
    []
  )

  useEffect(() => {
    if (mode === 'execution') {
      setSelectedNode(null)
    }
    if (mode === 'design') {
      useExecutionTimelineStore.setState({ selectedNodeId: null, selectedEventId: null })
    }
  }, [mode])

  // Fade transition when mode changes
  useEffect(() => {
    const modeChanged = prevModeRef.current !== mode
    if (modeChanged) {
      // Fade out
      setCanvasOpacity(0)
      // Fade in after a brief moment (allows viewport to be set)
      const timeoutId = setTimeout(() => {
        setCanvasOpacity(1)
      }, 50) // Very short delay to allow viewport calculation
      return () => clearTimeout(timeoutId)
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
        markerEnd: {
          type: MarkerType.Arrow,
          width: 30,
          height: 30,
        },
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

  // Fit view on initial load, when nodes/edges are added/removed, or when switching modes
  // When switching modes, fitView should center the diagram properly
  useEffect(() => {
    if (!reactFlowInstance || nodes.length === 0) {
      return
    }
    
    const modeChanged = prevModeRef.current !== mode
    
    // Count only workflow nodes (exclude terminal nodes) for change detection
    const workflowNodes = nodes.filter((n) => n.type !== 'terminal')
    const workflowNodesCount = workflowNodes.length
    const prevWorkflowNodesCount = prevNodesLengthRef.current
    
    const nodesCountChanged = prevWorkflowNodesCount !== workflowNodesCount
    const edgesCountChanged = prevEdgesLengthRef.current !== edges.length
    
    // Run fitView when mode changes or when workflow nodes/edges count changes
    // Don't trigger fitView when terminal nodes are added/removed
    if (modeChanged || nodesCountChanged || edgesCountChanged) {
      prevModeRef.current = mode
      prevNodesLengthRef.current = workflowNodesCount
      prevEdgesLengthRef.current = edges.length
      
      // When mode changes, wait a bit longer to ensure nodes are fully set and rendered
      // This is especially important when switching to execution mode without a run loaded
      // as execution nodes might be set asynchronously
      const delay = modeChanged ? 100 : 0
      
      setTimeout(() => {
        if (!reactFlowInstance) return
        
        // Double check nodes are still available (they might have been cleared)
        if (workflowNodes.length === 0) return
        
        // Use double requestAnimationFrame to ensure nodes are fully rendered and positioned
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!reactFlowInstance) return
            
            // Re-check workflow nodes (terminal nodes might have been added/removed)
            // Use the nodes prop directly since we're inside the effect
            const currentWorkflowNodes = nodes.filter((n: Node<NodeData>) => n.type !== 'terminal')
            if (currentWorkflowNodes.length === 0) return
            
            try {
              // Use simple fitView - ReactFlow handles centering automatically
              // Exclude terminal nodes from fitView - they should not affect the viewport
              reactFlowInstance.fitView({ 
                padding: 0.2, 
                duration: modeChanged ? 0 : 300, // Instant for mode changes to avoid jarring animation
                maxZoom: 0.85,
                includeHiddenNodes: false,
                nodes: currentWorkflowNodes, // Only fit workflow nodes, exclude terminals
              })
            } catch (error) {
              console.warn('Failed to fit view:', error)
            }
          })
        })
      }, delay)
    }
  }, [reactFlowInstance, edges.length, mode, nodes.length]) // Use nodes.length instead of nodes to avoid triggering on position changes

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

      const isEntryComponent = isEntryPointComponentRef(component.id) || isEntryPointComponentRef(component.slug ?? component.id)
      if (isEntryComponent) {
        const existingEntry = nodes.some(isEntryPointNode)
        if (existingEntry) {
          toast({
            title: 'Entry Point already exists',
            description: 'Each workflow can only have one Entry Point.',
            variant: 'destructive',
          })
          return
        }
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

      if ((component.slug ?? component.id) === 'entry-point') {
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
          // Pass workflowId to node data for entry point webhook URL
          workflowId: workflowId ?? undefined,
        } as any,
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
    [reactFlowInstance, setNodes, getComponent, markDirty, mode, nodes, toast]
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

    // If clicking the same node that's already selected, close the config panel
    if (selectedNode?.id === node.id) {
      setSelectedNode(null)
      return
    }

    // Close schedule sidebar when opening config panel
    if (resolvedOnCloseScheduleSidebar) {
      resolvedOnCloseScheduleSidebar()
    }
    setSelectedNode(node as Node<NodeData>)
  }, [mode, selectNode, selectEvent, onCloseScheduleSidebar, selectedNode])

  // Handle node double-click for text-block editing
  const onNodeDoubleClick: NodeMouseHandler = useCallback((event, node) => {
    if (mode !== 'design') return

    // Check if this is a text-block node
    const nodeData = node.data as any
    const componentRef = nodeData?.componentId || nodeData?.componentSlug
    const isTextBlock = componentRef === 'core.ui.text'

    if (isTextBlock) {
      event.stopPropagation()
      // Select the node to open config panel for editing
      setSelectedNode(node as Node<NodeData>)
    }
  }, [mode])

  // Handle pane click to deselect
  const onPaneClick = useCallback(() => {
    hasUserInteractedRef.current = true
    setSelectedNode(null)
  }, [])

  // Handle validation dock node click - select and scroll to node
  const handleValidationNodeClick = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node || !reactFlowInstance) return

    // Select the node in React Flow (for visual highlight)
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        selected: n.id === nodeId,
      }))
    )

    // Select the node for config panel
    setSelectedNode(node as Node<NodeData>)

    // Scroll to the node with less zoom (more padding = less zoom)
    reactFlowInstance.fitView({
      padding: 2,
      duration: 300,
      nodes: [{ id: nodeId }],
    })
  }, [nodes, reactFlowInstance, setNodes])

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

  // Notify parent when node selection changes
  useEffect(() => {
    onNodeSelectionChange?.(selectedNode)
  }, [selectedNode, onNodeSelectionChange])

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
        const totalEntryNodes = nodes.filter(isEntryPointNode).length
        const deletingEntryNodes = selectedNodes.filter(isEntryPointNode).length
        if (deletingEntryNodes > 0 && deletingEntryNodes >= totalEntryNodes) {
          toast({
            title: 'Entry Point required',
            description: 'Each workflow must keep one Entry Point node.',
            variant: 'destructive',
          })
          return
        }
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

  // Panel width changes are handled by CSS transitions, no manual viewport translation needed

  const entryPointActionsValue = useMemo(
    () => ({
      onOpenScheduleSidebar: () => {
        if (onClearNodeSelection) {
          onClearNodeSelection()
        }
        setSelectedNode(null)
        if (resolvedOnOpenScheduleSidebar) {
          resolvedOnOpenScheduleSidebar()
        }
      },
      onScheduleCreate: resolvedOnScheduleCreate,
    }),
    [resolvedOnOpenScheduleSidebar, resolvedOnScheduleCreate, onClearNodeSelection]
  )

  return (
    <EntryPointActionsContext.Provider value={entryPointActionsValue}>
      <div className={className}>
        <div className="flex h-full">
        <div 
          className="flex-1 relative bg-background overflow-hidden"
          style={{
            opacity: canvasOpacity,
            transition: 'opacity 200ms ease-in-out',
          }}
        >
          {/* Validation Dock - positioned relative to canvas */}
          <ValidationDock
            nodes={nodes}
            edges={edges}
            mode={mode}
            onNodeClick={handleValidationNodeClick}
          />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onInit={(instance : any) => {
              setReactFlowInstance(instance)
              if (nodes.length > 0) {
                try {
                  instance.fitView({ padding: 0.2, duration: 0, maxZoom: 0.85 })
                } catch (error) {
                  console.warn('Failed to fit view on init:', error)
                }
              }
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onMoveStart={() => {
              hasUserInteractedRef.current = true
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable
            nodesConnectable={mode === 'design'}
            elementsSelectable
          >

            <Background gap={16} className="!bg-background [&>pattern>circle]:!fill-muted-foreground/30" />
            <Controls position="bottom-left" className="!bg-card !border !border-border !rounded-md !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!fill-foreground [&>button:hover]:!bg-accent" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="cursor-grab active:cursor-grabbing !bg-card !border !border-border !rounded-md"
              maskColor="hsl(var(--background) / 0.7)"
              nodeColor={(node : any) => {
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
        {mode === 'design' && (
          <div
            className={cn(
              'relative overflow-hidden transition-all duration-150 ease-out',
              selectedNode ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            style={{
              width: selectedNode ? configPanelWidth : 0,
              transition: 'width 150ms ease-out, opacity 150ms ease-out',
            }}
          >
            {selectedNode && (
              <ConfigPanel
                selectedNode={selectedNode}
                onClose={() => setSelectedNode(null)}
                onUpdateNode={handleUpdateNode}
                workflowId={workflowId}
                workflowSchedules={resolvedWorkflowSchedules}
                schedulesLoading={resolvedSchedulesLoading}
                scheduleError={resolvedScheduleError}
                onScheduleCreate={resolvedOnScheduleCreate}
                onScheduleEdit={resolvedOnScheduleEdit}
                onScheduleAction={resolvedOnScheduleAction}
                onScheduleDelete={resolvedOnScheduleDelete}
                onViewSchedules={resolvedOnViewSchedules}
                onWidthChange={setConfigPanelWidth}
              />
            )}
          </div>
        )}
      </div>
      </div>
    </EntryPointActionsContext.Provider>
  )
}
