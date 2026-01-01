import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, type Node, useReactFlow, useUpdateNodeInternals } from 'reactflow'
import { ExecutionErrorView } from './ExecutionErrorView'
import { Loader2, CheckCircle, XCircle, Clock, Activity, AlertCircle, Pause, Terminal as TerminalIcon, Trash2, ChevronDown, ExternalLink } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/ui/markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import { useExecutionTimelineStore, type NodeVisualState } from '@/store/executionTimelineStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeStyle } from './nodeStyles'
import type { NodeData, FrontendNodeData } from '@/schemas/node'
import type { NodeStatus } from '@/schemas/node'
import type { InputPort } from '@/schemas/component'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { useThemeStore } from '@/store/themeStore'
import {
  type ComponentCategory,
  getCategorySeparatorColor,
  getCategoryHeaderBackgroundColor
} from '@/utils/categoryColors'
import { inputSupportsManualValue, runtimeInputTypeToPortDataType } from '@/utils/portUtils'
import { WebhookDetails } from './WebhookDetails'
import { useApiKeyStore } from '@/store/apiKeyStore'
import { API_BASE_URL } from '@/services/api'
import { useNavigate, useParams } from 'react-router-dom'
import { useEntryPointActions } from './Canvas'
import { ShieldAlert } from 'lucide-react'

const STATUS_ICONS = {
  running: Loader2,
  success: CheckCircle,
  error: XCircle,
  waiting: Clock,
  awaiting_input: ShieldAlert,
  skipped: LucideIcons.Ban,
  idle: null,
} as const

// Custom hook to detect mobile viewport
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isMobile
}

/**
 * Terminal button with portal-based panel rendering.
 */
interface TerminalButtonProps {
  id: string
  isTerminalOpen: boolean
  setIsTerminalOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  isTerminalLoading: boolean
  terminalSession: { chunks?: unknown[] } | undefined
  selectedRunId: string
  mode: string
  playbackMode: string
  isLiveFollowing: boolean
  focusedTerminalNodeId: string | null
  bringTerminalToFront: (nodeId: string) => void
}

function TerminalButton({
  id,
  isTerminalOpen,
  setIsTerminalOpen,
  isTerminalLoading,
  terminalSession,
  selectedRunId,
  mode,
  playbackMode,
  isLiveFollowing,
  bringTerminalToFront,
}: TerminalButtonProps) {
  const { getNodes, setNodes } = useReactFlow()
  const terminalNodeId = `terminal-${id}`
  const parentPositionRef = useRef<{ x: number; y: number; width: number } | null>(null)
  const terminalCreatedAtRef = useRef<number | null>(null)

  // Terminal dimensions (from NodeTerminalPanel: w-[520px], h-[360px] content + header ~40px + borders)
  const TERMINAL_WIDTH = 520
  const TERMINAL_HEIGHT = 402 // 360px content + ~40px header + 2px borders
  const TERMINAL_GAP = 35 // Gap between terminal bottom and parent top (30-40px as requested)

  // Get parent node width from node data (simpler, more reliable)
  const getParentNodeWidth = (parentNode: Node): number => {
    // Check if node has explicit width in data
    const uiSize = (parentNode.data as any)?.ui?.size as { width?: number } | undefined
    if (uiSize?.width) {
      return uiSize.width
    }

    // Check if node has width property directly (ReactFlow sometimes adds this)
    if ((parentNode as any).width) {
      return (parentNode as any).width
    }

    // Default width based on node type
    const isEntryPoint = (parentNode.data as any)?.componentSlug === 'entry-point'
    return isEntryPoint ? 205 : 320
  }

  // Calculate terminal position: render above parent, align right edges
  const calculateTerminalPosition = (parentNode: Node): { x: number; y: number } => {
    const parentWidth = getParentNodeWidth(parentNode)

    // Simple approach: position terminal above parent with gap, align right edges
    return {
      // Align right edges: terminal's right edge = parent's right edge
      // terminal.x + TERMINAL_WIDTH = parent.x + parentWidth
      x: parentNode.position.x + parentWidth - TERMINAL_WIDTH,
      // Position terminal above parent with gap
      // terminal.y + TERMINAL_HEIGHT + GAP = parent.y
      // So: terminal.y = parent.y - TERMINAL_HEIGHT - GAP
      y: parentNode.position.y - TERMINAL_HEIGHT - TERMINAL_GAP,
    }
  }

  // Create or remove terminal node when isTerminalOpen changes
  useEffect(() => {
    if (!isTerminalOpen) {
      // Only remove terminal when explicitly closed
      const nodes = getNodes()
      const terminalNode = nodes.find(n => n.id === terminalNodeId)
      if (terminalNode) {
        setNodes((nds) => nds.filter((n) => n.id !== terminalNodeId))
      }
      parentPositionRef.current = null
      return
    }

    // Use double requestAnimationFrame to ensure nodes are fully rendered and measured
    // This prevents the initial positioning artifact where the node appears too low
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nodes = getNodes()
        const terminalNode = nodes.find(n => n.id === terminalNodeId)
        const parentNode = nodes.find(n => n.id === id)

        // Only proceed if parent node exists - don't remove terminal if parent temporarily missing
        if (!parentNode) {
          // Parent node not found - don't remove terminal, just skip update
          // This prevents terminal from closing when nodes are being updated/filtered
          return
        }

        const parentWidth = getParentNodeWidth(parentNode)
        const expectedPosition = calculateTerminalPosition(parentNode)

        // Create terminal node if it doesn't exist
        if (!terminalNode) {
          const newTerminalNode: Node = {
            id: terminalNodeId,
            type: 'terminal',
            position: expectedPosition,
            data: {
              parentNodeId: id,
              runId: selectedRunId,
              timelineSync: mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing),
              onClose: () => setIsTerminalOpen(false),
            },
            draggable: true,
            selectable: true,
          }
          setNodes((nds) => [...nds, newTerminalNode])
          parentPositionRef.current = {
            x: parentNode.position.x,
            y: parentNode.position.y,
            width: parentWidth,
          }
          terminalCreatedAtRef.current = Date.now()
        } else {
          // Update terminal node data if needed (runId, timelineSync might have changed)
          const needsDataUpdate =
            terminalNode.data.runId !== selectedRunId ||
            terminalNode.data.timelineSync !== (mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing))

          // Update terminal node position to follow parent node if parent moved or resized
          const lastPosition = parentPositionRef.current
          const needsPositionUpdate =
            !lastPosition ||
            Math.abs(lastPosition.x - parentNode.position.x) > 1 ||
            Math.abs(lastPosition.y - parentNode.position.y) > 1 ||
            Math.abs(lastPosition.width - parentWidth) > 1 ||
            Math.abs(terminalNode.position.x - expectedPosition.x) > 1 ||
            Math.abs(terminalNode.position.y - expectedPosition.y) > 1

          if (needsDataUpdate || needsPositionUpdate) {
            setNodes((nds) =>
              nds.map((n) =>
                n.id === terminalNodeId
                  ? {
                    ...n,
                    position: needsPositionUpdate ? expectedPosition : n.position,
                    data: needsDataUpdate ? {
                      ...n.data,
                      runId: selectedRunId,
                      timelineSync: mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing),
                    } : n.data,
                  }
                  : n
              )
            )
            if (needsPositionUpdate) {
              parentPositionRef.current = {
                x: parentNode.position.x,
                y: parentNode.position.y,
                width: parentWidth,
              }
            }
          }
        }
      })
    })
    // getNodes and setNodes from useReactFlow are stable, but we'll exclude them to prevent infinite loops
    // setIsTerminalOpen is also stable (from useState), but excluding to be safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminalOpen, id, selectedRunId, mode, playbackMode, isLiveFollowing, terminalNodeId])

  // Periodically check if parent node moved or resized (for smooth following)
  useEffect(() => {
    if (!isTerminalOpen) {
      terminalCreatedAtRef.current = null
      return
    }

    const intervalId = setInterval(() => {
      // Skip position updates for the first 300ms after creation to avoid visual artifacts
      // The double requestAnimationFrame should handle initial positioning correctly
      if (terminalCreatedAtRef.current && Date.now() - terminalCreatedAtRef.current < 300) {
        return
      }

      const nodes = getNodes()
      const parentNode = nodes.find(n => n.id === id)
      const terminalNode = nodes.find(n => n.id === terminalNodeId)

      if (parentNode && terminalNode) {
        const parentWidth = getParentNodeWidth(parentNode)
        const expectedPosition = calculateTerminalPosition(parentNode)

        const lastPosition = parentPositionRef.current
        if (
          !lastPosition ||
          Math.abs(lastPosition.x - parentNode.position.x) > 1 ||
          Math.abs(lastPosition.y - parentNode.position.y) > 1 ||
          Math.abs(lastPosition.width - parentWidth) > 1 ||
          Math.abs(terminalNode.position.x - expectedPosition.x) > 1 ||
          Math.abs(terminalNode.position.y - expectedPosition.y) > 1
        ) {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === terminalNodeId
                ? {
                  ...n,
                  position: expectedPosition,
                }
                : n
            )
          )
          parentPositionRef.current = {
            x: parentNode.position.x,
            y: parentNode.position.y,
            width: parentWidth,
          }
        }
      }
    }, 100) // Check every 100ms

    return () => clearInterval(intervalId)
    // getNodes and setNodes from useReactFlow are stable, but we'll exclude them to be safe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminalOpen, id, terminalNodeId])


  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={() => {
          setIsTerminalOpen((prev) => !prev)
          bringTerminalToFront(id)
        }}
        className={cn(
          'flex items-center gap-1 rounded-full px-2 py-1 text-[11px] border transition-colors',
          isTerminalOpen
            ? 'bg-blue-600/15 text-blue-600 border-blue-400 shadow-sm ring-2 ring-blue-300/60'
            : 'bg-slate-900/60 text-slate-100 border-slate-700',
        )}
        title="Live Logs"
        aria-label="Live Logs"
      >
        <TerminalIcon className="h-3 w-3 text-current" />
        {isTerminalLoading && <span className="animate-pulse">…</span>}
        {!isTerminalLoading && terminalSession?.chunks?.length ? (
          <span className="w-2 h-2 rounded-full bg-green-400" />
        ) : null}
      </button>
    </div>
  )
}

/**
 * Parameters Display - Shows required and select parameters on the node
 */
interface ParametersDisplayProps {
  componentParameters: any[]
  requiredParams: any[]
  nodeParameters: Record<string, any> | undefined
  position?: 'top' | 'bottom'
}

function ParametersDisplay({
  componentParameters,
  requiredParams,
  nodeParameters,
  position = 'bottom'
}: ParametersDisplayProps) {
  // Show required parameters and important select parameters (like mode)
  // Exclude nested parameters (those with visibleWhen) like schemaType
  const selectParams = componentParameters.filter(
    param => param.type === 'select' && !param.required && !param.visibleWhen
  )
  const paramsToShow = [...requiredParams, ...selectParams]

  if (paramsToShow.length === 0) return null

  return (
    <div className={cn(
      position === 'top'
        ? "pb-2 mb-2 border-b border-border/50"
        : "pt-2 border-t border-border/50"
    )}>
      <div className="space-y-1">
        {paramsToShow.map((param) => {
          const value = nodeParameters?.[param.id]
          const effectiveValue = value !== undefined ? value : param.default
          const hasValue = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== ''
          const isDefault = value === undefined && param.default !== undefined

          // For select parameters, show the label instead of value
          let displayValue = hasValue ? effectiveValue : ''
          if (param.type === 'select' && hasValue && param.options) {
            const option = param.options.find((opt: any) => opt.value === effectiveValue)
            displayValue = option?.label || effectiveValue
          }

          return (
            <div key={`param-${param.id}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground font-medium truncate">
                {param.label}
              </span>
              <div className="flex items-center gap-1">
                {hasValue ? (
                  <span
                    className={cn(
                      "font-mono px-1 py-0.5 rounded text-[10px] truncate max-w-[80px]",
                      isDefault
                        ? "text-muted-foreground bg-muted/50 italic"
                        : param.type === 'select'
                          ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 font-semibold"
                          : "text-foreground bg-muted"
                    )}
                    title={isDefault ? `Default: ${String(displayValue)}` : String(displayValue)}
                  >
                    {String(displayValue)}
                  </span>
                ) : param.required ? (
                  <span className="text-red-500 text-[10px]">*required</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Enhanced WorkflowNode - Visual representation with timeline states
 */
export const WorkflowNode = ({ data, selected, id }: NodeProps<NodeData>) => {
  const { getComponent, loading } = useComponentStore()
  const { getNodes, getEdges, setNodes, deleteElements } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodeStates, selectedRunId, selectNode, isPlaying, playbackMode, isLiveFollowing } = useExecutionTimelineStore()
  const { markDirty } = useWorkflowStore()
  const { mode, focusedTerminalNodeId, bringTerminalToFront, openHumanInputDialog } = useWorkflowUiStore()
  // Note: hover effects use CSS :hover instead of React state to avoid re-renders (which cause image flicker)
  const prefetchTerminal = useExecutionStore((state) => state.prefetchTerminal)
  const terminalSession = useExecutionStore((state) => state.getTerminalSession(id, 'pty'))
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [isTerminalLoading, setIsTerminalLoading] = useState(false)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  // Inline label editing state
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [editingLabelValue, setEditingLabelValue] = useState('')
  const labelInputRef = useRef<HTMLInputElement | null>(null)

  // Entry Point specific state
  const navigate = useNavigate()
  const [showWebhookDialog, setShowWebhookDialog] = useState(false)

  // Error expansion state
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  // Get API key for webhook details if this is an entry point
  const { lastCreatedKey } = useApiKeyStore()
  const isMobile = useIsMobile()
  // Use last created key if available (from just-created flow), otherwise null (will show placeholder)
  const activeApiKey = lastCreatedKey

  const MIN_TEXT_WIDTH = 280
  const MAX_TEXT_WIDTH = 1800
  const MIN_TEXT_HEIGHT = 220
  const MAX_TEXT_HEIGHT = 1200
  const DEFAULT_TEXT_WIDTH = 320
  const DEFAULT_TEXT_HEIGHT = 300
  const [textSize, setTextSize] = useState<{ width: number; height: number }>(() => {
    const uiSize = (data as any)?.ui?.size as { width?: number; height?: number } | undefined
    return {
      width: uiSize?.width ?? DEFAULT_TEXT_WIDTH,
      height: uiSize?.height ?? DEFAULT_TEXT_HEIGHT,
    }
  })

  useEffect(() => {
    if (!isTerminalOpen) {
      return
    }

    let cancelled = false
    const loadTerminal = async () => {
      setIsTerminalLoading(true)
      try {
        await prefetchTerminal(id, 'pty', selectedRunId ?? undefined)
      } catch (error) {
        console.error('Failed to prefetch terminal output', error)
      } finally {
        if (!cancelled) {
          setIsTerminalLoading(false)
        }
      }
    }

    void loadTerminal()

    return () => {
      cancelled = true
    }
  }, [id, isTerminalOpen, prefetchTerminal, selectedRunId])

  // Cast to access extended frontend fields (componentId, componentSlug, status, etc.)
  const nodeData = data as FrontendNodeData

  // Get component metadata
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug
  const component = getComponent(componentRef)
  const isTextBlock = component?.id === 'core.ui.text'
  const isEntryPoint = component?.id === 'core.workflow.entrypoint'

  // Detect dark mode using theme store (reacts to theme changes)
  const theme = useThemeStore((state) => state.theme)
  const isDarkMode = theme === 'dark'

  // Get component category (default to 'input' for entry points)
  const componentCategory: ComponentCategory = (component?.category as ComponentCategory) ||
    (isEntryPoint ? 'input' : 'input')

  // Entry Point Helper Data
  // Get workflowId from store first, then from node data (passed from Canvas), then from route params
  // @ts-ignore - FIXME: Check actual store structure, temporarily bypassing to fix build
  const workflowIdFromStore = useWorkflowStore(state => state.workflow?.id)
  // Try to get workflowId from the node data if available (passed from Canvas)
  const workflowIdFromNode = (nodeData as any)?.workflowId as string | undefined
  // Try to get from URL params as last resort
  const params = useParams<{ id?: string }>()
  const workflowIdFromRoute = params?.id && params.id !== 'new' ? params.id : undefined
  const workflowId = workflowIdFromStore || workflowIdFromNode || workflowIdFromRoute
  const workflowInvokeUrl = workflowId
    ? `${API_BASE_URL}/workflows/${workflowId}/run`
    : `${API_BASE_URL}/workflows/{workflowId}/run`

  // Get schedule sidebar callback from Canvas context
  const { onOpenScheduleSidebar } = useEntryPointActions()


  const entryPointPayload = (() => {
    if (!isEntryPoint || !nodeData.parameters?.runtimeInputs) return {}
    try {
      const inputs = typeof nodeData.parameters.runtimeInputs === 'string'
        ? JSON.parse(nodeData.parameters.runtimeInputs)
        : nodeData.parameters.runtimeInputs

      if (!Array.isArray(inputs)) return {}

      return inputs.reduce((acc: any, input: any) => {
        acc[input.id] = input.type === 'number' ? 0 : input.type === 'boolean' ? false : 'value'
        return acc
      }, {})
    } catch {
      return {}
    }
  })()

  // Always call useEffect hooks in the same order (Rules of Hooks)
  // These hooks must be called BEFORE any early returns to maintain consistent hook order
  useEffect(() => {
    if (!isTextBlock) return
    const uiSize = (nodeData as any)?.ui?.size as { width?: number; height?: number } | undefined
    if (!uiSize) return
    setTextSize((current) => {
      const nextWidth = uiSize.width ?? current.width
      const nextHeight = uiSize.height ?? current.height
      const clamped = {
        width: Math.max(MIN_TEXT_WIDTH, Math.min(MAX_TEXT_WIDTH, nextWidth)),
        height: Math.max(MIN_TEXT_HEIGHT, Math.min(MAX_TEXT_HEIGHT, nextHeight)),
      }
      if (current.width === clamped.width && current.height === clamped.height) {
        return current
      }
      return clamped
    })
  }, [isTextBlock, nodeData])

  useEffect(() => {
    if (isTextBlock) {
      updateNodeInternals(id)
    }
  }, [id, isTextBlock, updateNodeInternals])

  // Resize handling hooks - must be called before any early returns
  const isResizing = useRef(false)

  const clampWidth = (width: number) =>
    Math.max(MIN_TEXT_WIDTH, Math.min(MAX_TEXT_WIDTH, width))

  const clampHeight = (height: number) =>
    Math.max(MIN_TEXT_HEIGHT, Math.min(MAX_TEXT_HEIGHT, height))

  const persistSize = (width: number, height: number) => {
    const clampedWidth = clampWidth(width)
    const clampedHeight = clampHeight(height)
    setTextSize({ width: clampedWidth, height: clampedHeight })
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
            ...node,
            data: {
              ...(node.data as any),
              ui: {
                ...(node.data as any).ui,
                size: {
                  width: clampedWidth,
                  height: clampedHeight,
                },
              },
            },
          }
          : node
      )
    )
    updateNodeInternals(id)
    markDirty()
  }

  const handleResizeStart = () => {
    isResizing.current = true
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    deleteElements({ nodes: [{ id }] })
    markDirty()
  }

  const handleResize = (_evt: unknown, params: { width: number; height: number }) => {
    const clampedWidth = clampWidth(params.width)
    const clampedHeight = clampHeight(params.height)

    // Direct DOM update for performance to avoid re-renders during drag
    if (nodeRef.current) {
      nodeRef.current.style.width = `${clampedWidth}px`
      nodeRef.current.style.minHeight = `${clampedHeight}px`
    }
  }

  const handleResizeEnd = (_evt: unknown, params: { width: number; height: number }) => {
    isResizing.current = false
    persistSize(params.width, params.height)
  }

  // Get timeline visual state for this node
  const visualState: NodeVisualState = nodeStates[id] || {
    status: 'idle',
    progress: 0,
    startTime: 0,
    eventCount: 0,
    totalEvents: 0,
    lastEvent: null,
    dataFlow: { input: [], output: [] }
  }

  // Auto-collapse error details when node status changes
  useEffect(() => {
    if (visualState.status !== 'error') {
      setShowErrorDetails(false)
    }
  }, [visualState.status])

  const supportsLiveLogs = component?.runner?.kind === 'docker'

  if (!component) {
    if (loading) {
      return (
        <div className="px-4 py-3 shadow-md rounded-lg border-2 border-dashed border-muted bg-background min-w-[200px]">
          <div className="text-sm text-muted-foreground">
            Loading component metadata…
          </div>
        </div>
      )
    }
    return (
      <div className="px-4 py-3 shadow-md rounded-lg border-2 border-red-500 dark:border-red-700 bg-red-50 dark:bg-red-900/40 min-w-[200px]">
        <div className="text-sm text-red-700 dark:text-red-300 font-medium">
          Component not found: {componentRef ?? 'unknown'}
        </div>
      </div>
    )
  }

  // Get icon component from Lucide (only if no logo)
  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box'
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>

  // Get styling based on visual state (prioritize timeline over node data)
  const effectiveStatus = mode === 'execution' && selectedRunId
    ? visualState.status
    : (nodeData.status || 'idle')
  const nodeStyle = getNodeStyle(effectiveStatus)

  // Get status icon
  const StatusIcon = STATUS_ICONS[effectiveStatus as keyof typeof STATUS_ICONS]

  // Enhanced styling for timeline visualization
  const isTimelineActive = mode === 'execution' && selectedRunId && visualState.status !== 'idle'
  const textBlockContent = typeof nodeData.parameters?.content === 'string'
    ? nodeData.parameters.content
    : ''
  const trimmedTextBlockContent = textBlockContent.trim()

  // Display label (custom or component name)
  const displayLabel = data.label || component.name
  // Check if user has set a custom label (different from component name)
  const hasCustomLabel = data.label && data.label !== component.name

  // Label editing handlers
  const handleStartEditing = () => {
    if (isEntryPoint || mode !== 'design') return
    setEditingLabelValue(data.label || component.name)
    setIsEditingLabel(true)
    // Focus the input after render
    setTimeout(() => labelInputRef.current?.focus(), 0)
  }

  const handleSaveLabel = () => {
    const trimmedValue = editingLabelValue.trim()
    if (trimmedValue && trimmedValue !== data.label) {
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, label: trimmedValue } }
            : n
        )
      )
      markDirty()
    }
    setIsEditingLabel(false)
  }

  const handleCancelEditing = () => {
    setIsEditingLabel(false)
  }

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveLabel()
    } else if (e.key === 'Escape') {
      handleCancelEditing()
    }
  }

  // Check if there are unfilled required parameters or inputs
  const componentParameters = component.parameters ?? []
  const componentInputs = nodeData.dynamicInputs ?? component.inputs ?? []
  const manualParameters = (nodeData.parameters ?? {}) as Record<string, unknown>
  const requiredParams = componentParameters.filter(param => param.required)
  const requiredInputs = componentInputs.filter(input => input.required)

  // DYNAMIC OUTPUTS: Use dynamicOutputs from node data (set by ConfigPanel via resolvePorts API)
  // Fall back to Entry Point special case, then static component.outputs
  let effectiveOutputs: any[] = nodeData.dynamicOutputs ?? (Array.isArray(component.outputs) ? component.outputs : [])

  // Legacy: For Entry Point without dynamicOutputs, generate outputs based on runtimeInputs parameter
  if (!nodeData.dynamicOutputs && component.id === 'core.workflow.entrypoint' && nodeData.parameters?.runtimeInputs) {
    try {
      const runtimeInputs = typeof nodeData.parameters.runtimeInputs === 'string'
        ? JSON.parse(nodeData.parameters.runtimeInputs)
        : nodeData.parameters.runtimeInputs

      if (Array.isArray(runtimeInputs) && runtimeInputs.length > 0) {
        effectiveOutputs = runtimeInputs.map((input: any) => {
          const dataType = runtimeInputTypeToPortDataType(input.type || 'text')
          return {
            id: input.id,
            label: input.label,
            dataType,
            description: input.description || `Runtime input: ${input.label}`,
          }
        })
      }
    } catch (error) {
      console.error('Failed to parse runtimeInputs:', error)
    }
  }
  const manualOverridesPort = (input: InputPort) =>
    input.valuePriority === 'manual-first'

  const manualValueProvidedForInput = (input: InputPort, hasConnection: boolean) => {
    const manualEligible = inputSupportsManualValue(input) || manualOverridesPort(input)
    if (!manualEligible) return false
    if (hasConnection && !manualOverridesPort(input)) return false
    const manualCandidate = manualParameters[input.id]
    if (manualCandidate === undefined || manualCandidate === null) return false
    if (typeof manualCandidate === 'string') {
      return manualCandidate.trim().length > 0
    }
    return true
  }

  const hasUnfilledRequired =
    // Check unfilled required parameters
    requiredParams.some(param => {
      const value = nodeData.parameters?.[param.id]
      const effectiveValue = value !== undefined ? value : param.default
      return effectiveValue === undefined || effectiveValue === null || effectiveValue === ''
    }) ||
    // Check unfilled required inputs (not connected)
    requiredInputs.some(input => {
      const hasConnection = Boolean(nodeData.inputs?.[input.id])
      if (hasConnection) return false
      if (manualValueProvidedForInput(input, hasConnection)) return false
      return true // No connection or manual value
    })

  // Progress ring component
  const ProgressBar = ({
    progress,
    events,
    totalEvents,
    isRunning,
    status,
  }: {
    progress: number
    events: number
    totalEvents: number
    isRunning: boolean
    status: NodeStatus
  }) => {
    const clampPercent = (value?: number) => {
      if (!Number.isFinite(value)) return undefined
      return Math.max(0, Math.min(value!, 100))
    }
    const normalizedProgress = clampPercent(progress)
    const normalizedFromEvents =
      totalEvents > 0 && Number.isFinite(events) && Number.isFinite(totalEvents)
        ? clampPercent((events / totalEvents) * 100)
        : undefined
    const fallbackWidth = isRunning ? 5 : 0

    // Calculate width - prefer normalizedFromEvents for accurate event-based progress
    // This ensures the bar shows the actual event progress (e.g., 4/10 = 40%)
    let calculatedWidth: number
    if (status === 'success') {
      calculatedWidth = 100
    } else if (normalizedFromEvents !== undefined && Number.isFinite(normalizedFromEvents)) {
      // Use event-based calculation (most accurate)
      calculatedWidth = normalizedFromEvents
    } else if (normalizedProgress !== undefined && Number.isFinite(normalizedProgress)) {
      // Fall back to progress prop
      calculatedWidth = normalizedProgress
    } else if (totalEvents > 0 && events > 0) {
      // Fallback: calculate directly from events/totalEvents
      calculatedWidth = Math.min(100, (events / totalEvents) * 100)
    } else {
      // Fall back to minimum width
      calculatedWidth = fallbackWidth
    }

    // Ensure width is clamped between 0 and 100, and is always a valid number
    const width = Number.isFinite(calculatedWidth)
      ? Math.max(0, Math.min(100, calculatedWidth))
      : 0
    const eventLabel = totalEvents > 0
      ? `${events}/${totalEvents} events`
      : `${events} ${events === 1 ? 'event' : 'events'}`

    // Determine bar color based on status
    // IMPORTANT: Only show green when status is 'success', otherwise use blue for progress visibility
    const getBarColor = () => {
      if (status === 'success') {
        return 'bg-green-500'
      }
      if (status === 'error') {
        return 'bg-red-600'
      }
      // For running/idle states, use solid blue to show progress (better contrast and visibility)
      // Use solid color instead of gradient for better browser compatibility
      if (isRunning) {
        return 'bg-blue-500 animate-pulse'
      }
      return 'bg-blue-500'
    }

    // Ensure width is always a string with % for the style
    const widthStyle = `${width}%`

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Events observed</span>
          <span>{eventLabel}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden relative">
          <div
            className={cn(
              'absolute left-0 top-0 h-full rounded-full transition-all duration-500',
              getBarColor(),
            )}
            style={{
              width: widthStyle,
              minWidth: width > 0 ? '2px' : '0px', // Ensure minimum 2px for visibility
            }}
          />
        </div>
      </div>
    )
  }

  // Event count badge

  // Get category-based separator color (only for the header separator)
  const getSeparatorColor = (): string | undefined => {
    // Only apply category colors when node is idle
    if ((!isTimelineActive || visualState.status === 'idle') &&
      (!nodeData.status || nodeData.status === 'idle')) {
      return getCategorySeparatorColor(componentCategory, isDarkMode)
    }
    return undefined
  }

  // Get category-based header background color (only for the header section)
  const getHeaderBackgroundColor = (): string | undefined => {
    // Always apply category colors in both design and execution modes
    return getCategoryHeaderBackgroundColor(componentCategory, isDarkMode)
  }

  const separatorColor = getSeparatorColor()
  const headerBackgroundColor = getHeaderBackgroundColor()

  return (
    <div
      className={cn(
        'shadow-lg border-2 transition-[box-shadow,background-color,border-color,transform] relative group',
        'bg-background',
        // Entry point nodes have more rounded corners (even more rounded)
        isEntryPoint ? 'rounded-[1.5rem]' : 'rounded-lg',
        isTextBlock ? 'min-w-[240px] max-w-none flex flex-col' : 'min-w-[240px] max-w-[280px]',

        // Timeline active states for entry point (when it has active execution status)
        isEntryPoint && isTimelineActive && effectiveStatus === 'running' && !isPlaying && 'border-dashed',

        // Enhanced border styling for timeline (non-entry-point nodes only)
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && 'border-blue-400',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && !isPlaying && 'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'error' && 'border-red-400',

        // Node status states (non-entry-point nodes only)
        !isEntryPoint && (effectiveStatus !== 'idle' || isTimelineActive) && [
          nodeStyle.bg,
          nodeStyle.border,
        ],

        // Default state (all nodes when idle) - white/grey background
        (!nodeData.status || nodeData.status === 'idle') && !isTimelineActive && [
          'border-border',
        ],

        // Selected state: blue gradient shadow highlight (pure glow, no border)
        selected && 'shadow-[0_0_15px_rgba(59,130,246,0.4),0_0_30px_rgba(59,130,246,0.3)]',
        selected && 'hover:shadow-[0_0_25px_rgba(59,130,246,0.6),0_0_45px_rgba(59,130,246,0.4)]',

        // Validation styling removed - now shown in ValidationDock

        // Interactive states - use CSS hover to avoid re-renders
        !selected && 'hover:shadow-xl',
        'hover:scale-[1.02]',
        selectedRunId && 'cursor-pointer'
      )}
      ref={nodeRef}
      onClick={() => selectedRunId && selectNode(id)}
      style={{
        // Text block and entry point sizing
        ...(isTextBlock
          ? {
            width: Math.max(MIN_TEXT_WIDTH, textSize.width ?? DEFAULT_TEXT_WIDTH),
            minHeight: Math.max(MIN_TEXT_HEIGHT, textSize.height ?? DEFAULT_TEXT_HEIGHT),
          }
          : isEntryPoint
            ? { width: 160, minHeight: 160 }
            : {}),
      }}
    >
      {isTextBlock && mode === 'design' && (
        <NodeResizer
          minWidth={MIN_TEXT_WIDTH}
          maxWidth={MAX_TEXT_WIDTH}
          minHeight={MIN_TEXT_HEIGHT}
          maxHeight={MAX_TEXT_HEIGHT}
          isVisible
          handleClassName="text-node-resize-handle"
          lineClassName="text-node-resize-line"
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}
      {/* Header */}
      <div
        className={cn(
          'px-3 py-2 border-b relative',
          // Match parent's rounded corners at the top
          isEntryPoint ? 'rounded-t-[1.5rem]' : 'rounded-t-lg'
        )}
        style={{
          borderColor: separatorColor || 'hsl(var(--border) / 0.5)',
          backgroundColor: headerBackgroundColor || undefined,
        }}
      >
        <div className="flex items-start gap-2">
          {component.logo ? (
            <img
              src={component.logo}
              alt={component.name}
              className="h-5 w-5 mt-0.5 flex-shrink-0 object-contain"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <IconComponent className={cn(
            "h-5 w-5 mt-0.5 flex-shrink-0 text-foreground",
            component.logo && "hidden"
          )} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                {isEditingLabel ? (
                  <input
                    ref={labelInputRef}
                    type="text"
                    value={editingLabelValue}
                    onChange={(e) => setEditingLabelValue(e.target.value)}
                    onBlur={handleSaveLabel}
                    onKeyDown={handleLabelKeyDown}
                    className="text-sm font-semibold bg-transparent border-b border-primary outline-none w-full py-0"
                    autoFocus
                  />
                ) : (
                  <div
                    className={cn(
                      "group/label",
                      !isEntryPoint && mode === 'design' && "cursor-text"
                    )}
                    onDoubleClick={handleStartEditing}
                    title={!isEntryPoint && mode === 'design' ? "Double-click to rename" : undefined}
                  >
                    <h3 className="text-sm font-semibold truncate">{displayLabel}</h3>
                    {hasCustomLabel && (
                      <span className="text-[10px] text-muted-foreground opacity-70 truncate block">
                        {component.name}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* Delete button (Design Mode only, not Entry Point) */}




                {/* Embedded Webhook Dialog (Controlled) */}
                {isEntryPoint && (
                  <div style={{ display: 'none' }}>
                    <WebhookDetails
                      url={workflowInvokeUrl}
                      payload={entryPointPayload}
                      apiKey={activeApiKey}
                      open={showWebhookDialog}
                      onOpenChange={setShowWebhookDialog}
                    />
                  </div>
                )}

                {hasUnfilledRequired && !nodeData.status && (
                  <span className="text-red-500 text-xs" title="Required fields missing">!</span>
                )}
                {StatusIcon && (!isTimelineActive || effectiveStatus !== 'running' || isPlaying) && effectiveStatus !== 'success' && (
                  <StatusIcon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      nodeStyle.iconClass,
                      isTimelineActive && effectiveStatus === 'running' && isPlaying && 'animate-spin',
                      isTimelineActive && effectiveStatus === 'error' && 'animate-bounce',
                    )}
                  />
                )}
                {/* Only docker-runner components expose live logs (they have streaming terminal output). */}
                {supportsLiveLogs && mode === 'execution' && selectedRunId && (
                  <TerminalButton
                    id={id}
                    isTerminalOpen={isTerminalOpen}
                    setIsTerminalOpen={setIsTerminalOpen}
                    isTerminalLoading={isTerminalLoading}
                    terminalSession={terminalSession}
                    selectedRunId={selectedRunId}
                    mode={mode}
                    playbackMode={playbackMode}
                    isLiveFollowing={isLiveFollowing}
                    focusedTerminalNodeId={focusedTerminalNodeId}
                    bringTerminalToFront={bringTerminalToFront}
                  />
                )}

                {/* Delete button - shows only in design mode */}
                {mode === 'design' && !isEntryPoint && (
                  <button
                    type="button"
                    className={cn(
                      "p-1 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-all",
                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    title="Delete node"
                    aria-label="Delete node"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status and Events Section - Below header */}
      {isTimelineActive && (
        <div className="px-3 py-2 border-b border-border/50 bg-muted/30 space-y-2">
          {/* Status badges */}
          {visualState.status === 'running' && (
            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
              {playbackMode === 'live' ? (
                <>
                  <Activity className="h-3 w-3 mr-1 animate-pulse" />
                  Live
                </>
              ) : isPlaying ? (
                <>
                  <Activity className="h-3 w-3 mr-1" />
                  Running
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3 mr-1" />
                  Paused
                </>
              )}
            </Badge>
          )}
          {visualState.status === 'success' && (
            <Badge variant="secondary" className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700">
              <CheckCircle className="h-3 w-3 mr-1" />
              Completed
            </Badge>
          )}
          {visualState.status === 'error' && (
            <Badge
              variant="secondary"
              className={cn(
                "text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 cursor-pointer select-none transition-all hover:ring-2 hover:ring-red-400/50 items-center gap-1",
                showErrorDetails && "ring-2 ring-red-400/50"
              )}
              onClick={() => setShowErrorDetails(!showErrorDetails)}
              title="Click to toggle error details"
            >
              <AlertCircle className="h-3 w-3" />
              <span>{visualState.lastEvent?.error?.type || 'Failed'}</span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform duration-200",
                  showErrorDetails && "rotate-180"
                )}
              />
            </Badge>
          )}
          {visualState.status === 'skipped' && (
            <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-600">
              <LucideIcons.Ban className="h-3 w-3 mr-1" />
              Skipped
            </Badge>
          )}

          {/* View Child Run button - shown when this node spawned a child workflow */}
          {visualState.lastMetadata?.childRunId && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs font-medium gap-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/20 dark:hover:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/runs/${visualState.lastMetadata!.childRunId}`)
              }}
            >
              <ExternalLink className="h-3 w-3" />
              View Child Run
            </Button>
          )}

          {/* Detailed error representation - shown only when expanded */}
          {visualState.status === 'error' && showErrorDetails && visualState.lastEvent?.error && (
            <ExecutionErrorView
              error={visualState.lastEvent.error}
              className="mt-2"
            />
          )}

          {/* Progress bar and events */}
          <ProgressBar
            progress={Number.isFinite(visualState.progress) ? visualState.progress : 0}
            events={visualState.eventCount}
            totalEvents={visualState.totalEvents}
            isRunning={visualState.status === 'running'}
            status={visualState.status}
          />
        </div>
      )}

      {/* Body - Input/Output Ports */}
      <div className={cn(
        "px-3 py-3 pb-4 space-y-2",
        isTextBlock && "flex flex-col flex-1"
      )}>
        {effectiveStatus === 'awaiting_input' && visualState.humanInputRequestId && (
          <div className={cn("mb-2", isEntryPoint && "hidden")}>
            <Button
              variant="outline"
              className="w-full bg-blue-600/10 hover:bg-blue-600/20 text-blue-700 dark:text-blue-300 border-blue-500/50 shadow-sm animate-pulse h-8 text-xs font-semibold"
              onClick={(e) => {
                e.stopPropagation()
                openHumanInputDialog(visualState.humanInputRequestId!)
              }}
            >
              <LucideIcons.ShieldAlert className="w-3.5 h-3.5 mr-2" />
              Action Required
            </Button>
          </div>
        )}
        {isTextBlock && (
          trimmedTextBlockContent.length > 0 ? (
            <MarkdownView
              content={trimmedTextBlockContent}
              dataTestId="text-block-content"
              className={cn(
                'w-full rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-3 overflow-x-hidden overflow-y-auto break-words',
                'prose prose-base dark:prose-invert max-w-none text-foreground',
                'flex-1 min-h-0'
              )}
              onEdit={(next) => {
                console.log('[WorkflowNode] Checkbox clicked, updating content:', next)
                setNodes((nds) => nds.map((n) => {
                  if (n.id !== id) return n
                  const currentParams = (n.data as any).parameters || {}
                  const updatedParams = { ...currentParams, content: next }
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      // Update both parameters and config to keep them in sync
                      // The serializer uses parameters || config, and the graph signature
                      // needs both to be updated for change detection to work
                      parameters: updatedParams,
                      config: updatedParams,
                    },
                  }
                }))
                // Mark workflow as dirty so changes can be saved
                markDirty()
              }}
            />
          ) : (
            // Fallback helper text (children only, no dangerouslySetInnerHTML)
            <div
              className={cn(
                'rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm text-muted-foreground leading-relaxed',
                'flex-1 min-h-0'
              )}
              data-testid="text-block-content"
            >
              {'Add notes in the configuration panel to share context with teammates.'}
            </div>
          )
        )}
        {/* Entry Point - Split Layout: Left (Actions) 60% / Right (Outputs) 40% */}
        {isEntryPoint ? (
          <div className="flex gap-3 mt-1">
            {/* Left side: Action buttons stacked vertically as pills */}
            <div className="flex-[0.6] flex flex-col gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowWebhookDialog(true)
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.Webhook className="h-3 w-3 flex-shrink-0" />
                <span>Webhook</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  // Open schedule sidebar instead of navigating
                  if (onOpenScheduleSidebar) {
                    onOpenScheduleSidebar()
                  } else {
                    // Fallback to navigation if callback not available
                    navigate(`/schedules?workflowId=${workflowId}`)
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.CalendarClock className="h-3 w-3 flex-shrink-0" />
                <span>Schedules</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  // In design mode, programmatically trigger node selection by clicking the node element
                  // This will open the config panel where inputs are managed
                  if (mode === 'design' && nodeRef.current) {
                    // Create a synthetic click event that will bubble up to React Flow
                    const clickEvent = new MouseEvent('click', {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                    })
                    // Use setTimeout to ensure this happens after the current event handler
                    setTimeout(() => {
                      nodeRef.current?.dispatchEvent(clickEvent)
                    }, 10)
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-muted/60 hover:bg-muted transition-colors text-[10px] font-medium text-muted-foreground hover:text-foreground w-fit"
              >
                <LucideIcons.Settings className="h-3 w-3 flex-shrink-0" />
                <span>Inputs</span>
              </button>
            </div>

            {/* Right side: Output ports */}
            <div className="flex-[0.4] flex flex-col justify-start">
              {effectiveOutputs.length > 0 ? (
                <div className="space-y-1.5">
                  {effectiveOutputs.map((output) => (
                    <div key={output.id} className="relative flex items-center justify-end gap-2 text-xs">
                      <div className="flex-1 text-right">
                        <div className="text-muted-foreground font-medium">{output.label}</div>
                      </div>
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={output.id}
                        className="!w-[10px] !h-[10px] !border-2 !border-green-500 !bg-green-500 !rounded-full"
                        style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                      />
                    </div>
                  ))}
                </div>
              ) : isEntryPoint ? (
                <div className="relative flex items-center justify-end gap-2 text-xs">
                  <div className="flex-1 text-right italic font-medium opacity-60">
                    Triggered
                  </div>
                  <Handle
                    type="source"
                    position={Position.Right}
                    // No ID provided - matches 'undefined' in React Flow, 
                    // which is what edges created without sourceHandle expect.
                    className="!w-[10px] !h-[10px] !border-2 !border-blue-500 !bg-blue-500 !rounded-full"
                    style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                  />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground/60 text-center py-2">
                  No outputs
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Parameters Display - Shown above ports for non-entry-point nodes */}
        {!isEntryPoint && (
          <ParametersDisplay
            componentParameters={componentParameters}
            requiredParams={requiredParams}
            nodeParameters={nodeData.parameters}
            position="top"
          />
        )}

        {/* Input Ports (not shown for entry points) */}
        {!isEntryPoint && componentInputs.length > 0 && (
          <div className="space-y-1.5">
            {componentInputs.map((input) => {
              // Check if this input has a connection
              const edges = getEdges()
              const connection = edges.find(edge => edge.target === id && edge.targetHandle === input.id)
              const hasConnection = Boolean(connection)

              // Get source node and output info if connected
              const manualCandidate = manualParameters[input.id]
              const manualValueProvided = manualValueProvidedForInput(input, hasConnection)

              let sourceInfo: string | null = null
              if (!manualValueProvided && connection) {
                const sourceNode = getNodes().find(n => n.id === connection.source)
                if (sourceNode) {
                  const sourceComponent = getComponent(
                    (sourceNode.data as any).componentId ?? (sourceNode.data as any).componentSlug
                  )
                  if (sourceComponent) {
                    const sourceOutput = sourceComponent.outputs.find(o => o.id === connection.sourceHandle)
                    sourceInfo = sourceOutput?.label || 'Connected'
                  }
                }
              }

              const manualDisplay =
                manualValueProvided &&
                  inputSupportsManualValue(input) &&
                  typeof manualCandidate === 'string'
                  ? manualCandidate.trim()
                  : ''
              const previewText =
                manualDisplay.length > 24
                  ? `${manualDisplay.slice(0, 24)}…`
                  : manualDisplay
              const handleClassName = cn(
                '!w-[10px] !h-[10px] !border-2 !rounded-full',
                input.required
                  ? '!bg-blue-500 !border-blue-500'
                  : '!bg-background !border-blue-500'
              )

              return (
                <div key={input.id} className="relative flex items-center gap-2 text-xs">
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={input.id}
                    className={handleClassName}
                    style={{ top: '50%', left: '-18px', transform: 'translateY(-50%)' }}
                  />
                  <div className="flex-1">
                    <div className="text-muted-foreground font-medium">{input.label}</div>
                    {input.required && !sourceInfo && !manualValueProvided && (
                      <span className="text-red-500 text-[10px]">*required</span>
                    )}
                    {manualValueProvided && manualDisplay && (
                      <span
                        className="text-muted-foreground text-[10px] italic"
                        title={manualDisplay}
                      >
                        Manual: {previewText}
                      </span>
                    )}
                    {manualValueProvided && !manualDisplay && (
                      <span className="text-muted-foreground text-[10px] italic">Manual value</span>
                    )}
                    {!manualValueProvided && sourceInfo && (
                      <span className="text-muted-foreground text-[10px] italic" title={`Connected to: ${sourceInfo}`}>
                        {sourceInfo}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Output Ports - Regular only (not shown for entry points - they're in the split layout) */}
        {!isEntryPoint && effectiveOutputs.filter((o: any) => !o.isBranching).length > 0 && (
          <div className="space-y-1.5">
            {effectiveOutputs.filter((o: any) => !o.isBranching).map((output: any) => (
              <div key={output.id} className="relative flex items-center justify-end gap-2 text-xs">
                <div className="flex-1 text-right">
                  <div className="text-muted-foreground font-medium">{output.label}</div>
                </div>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.id}
                  className="!w-[10px] !h-[10px] !border-2 !border-green-500 !bg-green-500 !rounded-full"
                  style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Branching Outputs - Compact horizontal section */}
        {!isEntryPoint && (() => {
          const branchingOutputs = effectiveOutputs.filter((o: any) => o.isBranching)
          if (branchingOutputs.length === 0) return null

          // Determine which branches are active (for execution mode)
          const data = isTimelineActive ? visualState.lastEvent?.data : undefined
          const activatedPorts = data?.activatedPorts

          // Legacy fallback for manual-approval
          const legacyActiveBranchId = !activatedPorts && data
            ? (data.approved === true ? 'approved'
              : data.approved === false ? 'rejected'
                : null)
            : null

          const isNodeFinished = isTimelineActive && (visualState.status === 'success' || visualState.status === 'error')
          const isNodeSkipped = isTimelineActive && visualState.status === 'skipped'
          const hasBranchDecision = isNodeFinished || isNodeSkipped

          return (
            <div className="mt-2 pt-2 border-t border-dashed border-amber-300/50 dark:border-amber-700/50">
              <div className="flex gap-2">
                {/* Left side: Title */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <LucideIcons.GitBranch className="h-3 w-3 text-amber-500 dark:text-amber-400" />
                  <span className="text-[9px] font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wider">
                    Branches
                  </span>
                </div>

                {/* Right side: Branch pills stacked */}
                <div className="flex flex-col flex-1 gap-1">
                  {branchingOutputs.map((output: any) => {
                    const isActive = isNodeFinished && (
                      activatedPorts
                        ? activatedPorts.includes(output.id)
                        : legacyActiveBranchId === output.id
                    )

                    const isInactive = isNodeSkipped || (isNodeFinished && !isActive)
                    const branchColor = output.branchColor || 'amber'

                    // Color classes for design mode (no decision yet)
                    const designModeColors: Record<string, string> = {
                      green: "bg-green-50/80 dark:bg-green-900/20 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300",
                      red: "bg-red-50/80 dark:bg-red-900/20 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300",
                      amber: "bg-amber-50/80 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300",
                      blue: "bg-blue-50/80 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300",
                      purple: "bg-purple-50/80 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 text-purple-700 dark:text-purple-300",
                      slate: "bg-slate-100/80 dark:bg-slate-800/30 border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-300",
                    }

                    // Handle colors for design mode
                    const handleDesignColors: Record<string, string> = {
                      green: "!border-green-500 !bg-green-500",
                      red: "!border-red-500 !bg-red-500",
                      amber: "!border-amber-500 !bg-amber-500",
                      blue: "!border-blue-500 !bg-blue-500",
                      purple: "!border-purple-500 !bg-purple-500",
                      slate: "!border-slate-500 !bg-slate-500",
                    }

                    return (
                      <div
                        key={output.id}
                        className="relative flex items-center justify-end gap-2 text-xs"
                      >
                        <div
                          className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all",
                            "border",
                            // No decision yet (design or running)
                            !hasBranchDecision && designModeColors[branchColor],
                            // Active branch - always green
                            isActive && "bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 ring-1 ring-green-400/50",
                            // Inactive/Skipped branch - MUTED/OFF state
                            isInactive && "bg-slate-50/50 dark:bg-slate-900/20 border-dashed border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-600 opacity-30 grayscale-[0.8]",
                          )}
                        >
                          {isActive && <LucideIcons.Check className="h-2.5 w-2.5" />}
                          {isInactive && <LucideIcons.X className="h-2.5 w-2.5 text-slate-400/50" />}
                          <span>{output.label}</span>
                        </div>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={output.id}
                          className={cn(
                            "!w-[10px] !h-[10px] !border-2 !rounded-full",
                            !hasBranchDecision && handleDesignColors[branchColor],
                            isActive && "!border-green-500 !bg-green-500",
                            isInactive && "!border-slate-300 !bg-slate-200 dark:!bg-slate-800 opacity-30"
                          )}
                          style={{ top: '50%', right: '-18px', transform: 'translateY(-50%)' }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()
        }


        {/* Enhanced Execution Status Messages */}
        {
          isTimelineActive && (
            <div className="pt-2 border-t border-border/50">
              {visualState.lastEvent && (
                <div className="text-xs text-muted-foreground mt-2">
                  <div className="font-medium">
                    Last: {visualState.lastEvent.type.replace('_', ' ')}
                  </div>
                  {visualState.lastEvent.message && (
                    <div className="truncate mt-1" title={visualState.lastEvent.message}>
                      {visualState.lastEvent.message}
                    </div>
                  )}
                </div>
              )}

              {/* Legacy status messages */}
              {!isTimelineActive && nodeData.status === 'success' && nodeData.executionTime && (
                <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300">
                  {nodeData.executionTime}ms
                </Badge>
              )}

              {!isTimelineActive && nodeData.status === 'error' && nodeData.error && (
                <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 truncate max-w-full" title={nodeData.error}>
                  ✗ {nodeData.error}
                </Badge>
              )}
            </div>
          )
        }

        {/* Legacy status messages (when not in timeline mode) */}
        {
          !isTimelineActive && nodeData.status === 'success' && nodeData.executionTime && (
            <div className="pt-2 border-t border-border">
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                ✓ {nodeData.executionTime}ms
              </Badge>
            </div>
          )
        }

        {
          !isTimelineActive && nodeData.status === 'error' && nodeData.error && (
            <div className="pt-2 border-t border-red-200">
              <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 truncate max-w-full" title={nodeData.error}>
                ✗ {nodeData.error}
              </Badge>
            </div>
          )
        }
      </div >
    </div >
  )
}
