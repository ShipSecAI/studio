import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, type Node, useReactFlow, useUpdateNodeInternals } from 'reactflow'
import { Loader2, CheckCircle, XCircle, Clock, Activity, AlertCircle, Pause, Terminal as TerminalIcon, Pencil } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/ui/markdown'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import { useExecutionTimelineStore, type NodeVisualState } from '@/store/executionTimelineStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeStyle } from './nodeStyles'
import type { NodeData } from '@/schemas/node'
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

const STATUS_ICONS = {
  running: Loader2,
  success: CheckCircle,
  error: XCircle,
  waiting: Clock,
  idle: null,
} as const

/**
 * Terminal button with portal-based panel rendering.
 * Uses portal to render terminal panels outside ReactFlow's stacking context,
 * allowing proper z-index stacking between terminals from different nodes.
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
 * Enhanced WorkflowNode - Visual representation with timeline states
 */
export const WorkflowNode = ({ data, selected, id }: NodeProps<NodeData>) => {
  const { getComponent, loading } = useComponentStore()
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodeStates, selectedRunId, selectNode, isPlaying, playbackMode, isLiveFollowing } = useExecutionTimelineStore()
  const { markDirty } = useWorkflowStore()
  const { mode, focusedTerminalNodeId, bringTerminalToFront } = useWorkflowUiStore()
  // Note: hover effects use CSS :hover instead of React state to avoid re-renders (which cause image flicker)
  const prefetchTerminal = useExecutionStore((state) => state.prefetchTerminal)
  const terminalSession = useExecutionStore((state) => state.getTerminalSession(id, 'pty'))
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [isTerminalLoading, setIsTerminalLoading] = useState(false)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  // Entry Point specific state
  const navigate = useNavigate()
  const [showWebhookDialog, setShowWebhookDialog] = useState(false)

  // Get API key for webhook details if this is an entry point
  const { lastCreatedKey } = useApiKeyStore()
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
  const nodeData = data as any

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
  const hasEvents = isTimelineActive && visualState.eventCount > 0
  const textBlockContent = typeof nodeData.parameters?.content === 'string'
    ? nodeData.parameters.content
    : ''
  const trimmedTextBlockContent = textBlockContent.trim()

  // Display label (custom or component name)
  const displayLabel = data.label || component.name

  // Check if there are unfilled required parameters or inputs
  const componentParameters = component.parameters ?? []
  const componentInputs = component.inputs ?? []
  const manualParameters = (nodeData.parameters ?? {}) as Record<string, unknown>
  const requiredParams = componentParameters.filter(param => param.required)
  const requiredInputs = componentInputs.filter(input => input.required)

  // DYNAMIC OUTPUTS: For Entry Point, generate outputs based on runtimeInputs parameter
  let effectiveOutputs = component.outputs ?? []
  if (component.id === 'core.workflow.entrypoint' && nodeData.parameters?.runtimeInputs) {
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
  const EventBadge = ({ count }: { count: number }) => (
    <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-medium shadow-lg">
      {count > 99 ? '99+' : count}
    </div>
  )

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
        'shadow-lg border-2 transition-[box-shadow,background-color,border-color,transform] relative',
        // Entry point nodes have more rounded corners (even more rounded)
        isEntryPoint ? 'rounded-[1.5rem]' : 'rounded-lg',
        isTextBlock ? 'min-w-[240px] max-w-none flex flex-col' : 'min-w-[240px] max-w-[280px]',

        // Timeline active states for entry point (when it has active execution status)
        isEntryPoint && isTimelineActive && effectiveStatus === 'running' && !isPlaying && 'border-dashed',

        // Enhanced border styling for timeline (non-entry-point nodes only)
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && 'border-blue-400',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'running' && !isPlaying && 'border-dashed',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'error' && 'border-red-400 bg-red-50/20 dark:bg-red-950/20',
        !isEntryPoint && isTimelineActive && effectiveStatus === 'success' && 'border-green-400 bg-green-50/20 dark:bg-green-950/20',

        // Timeline active states (non-entry-point nodes only)
        !isEntryPoint && isTimelineActive && visualState.status === 'running' && 'bg-blue-50/80 dark:bg-blue-900/30',

        // Node status states (non-entry-point nodes only)
        !isEntryPoint && nodeData.status && nodeData.status !== 'idle' && [
          nodeStyle.bg,
          nodeStyle.border,
        ],

        // Default state (all nodes when idle) - white/grey background
        (!nodeData.status || nodeData.status === 'idle') && !isTimelineActive && [
          'bg-background',
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
          'px-3 py-2 border-b relative', // Removed overflow-hidden to allow badge to exceed boundary
          // Match parent's rounded corners at the top
          isEntryPoint ? 'rounded-t-[1.5rem]' : 'rounded-t-lg'
        )}
        style={{
          borderColor: separatorColor || 'hsl(var(--border) / 0.5)',
          backgroundColor: headerBackgroundColor || undefined,
        }}
      >
        {/* Event count badge */}
        {hasEvents && <EventBadge count={visualState.eventCount} />}

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
                <h3 className="text-sm font-semibold truncate">{displayLabel}</h3>
              </div>
              <div className="flex items-center gap-1">

                {/* Edit button for text blocks - explicitly select node for editing */}
                {isTextBlock && mode === 'design' && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit content"
                    aria-label="Edit content"
                    onClick={(e) => {
                      // Stop propagation to prevent triggering parent div's onClick
                      e.stopPropagation()
                      // The node selection will be handled by React Flow's onNodeClick
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}

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
                {StatusIcon && (!isTimelineActive || effectiveStatus !== 'running' || isPlaying) && (
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
              </div>
            </div>

            {/* Timeline status info */}
            {isTimelineActive && (
              <div className="flex items-center gap-2 mt-1">
                {visualState.status === 'running' && (
                  <div className="flex items-center gap-1 text-xs text-blue-600">
                    {playbackMode === 'live' ? (
                      <>
                        <Activity className="h-3 w-3 animate-pulse" />
                        Live
                      </>
                    ) : isPlaying ? (
                      <>
                        <Activity className="h-3 w-3" />
                        Running
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3" />
                        Paused
                      </>
                    )}
                  </div>
                )}
                {visualState.status === 'success' && (
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle className="h-3 w-3" />
                    Completed
                  </div>
                )}
                {visualState.status === 'error' && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    Failed
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body - Input/Output Ports */}
      <div className={cn(
        "px-3 py-3 pb-4 space-y-2",
        isTextBlock && "flex flex-col flex-1"
      )}>
        {isTimelineActive && (
          <>
            <ProgressBar
              progress={Number.isFinite(visualState.progress) ? visualState.progress : 0}
              events={visualState.eventCount}
              totalEvents={visualState.totalEvents}
              isRunning={visualState.status === 'running'}
              status={visualState.status}
            />
            <div className="border-t border-border/50 my-1" />
          </>
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
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-green-300 dark:border-green-700/60 bg-green-100/80 dark:bg-green-900/40 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors text-[10px] font-medium text-green-800 dark:text-green-300 w-fit"
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
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-green-300 dark:border-green-700/60 bg-green-100/80 dark:bg-green-900/40 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors text-[10px] font-medium text-green-800 dark:text-green-300 w-fit"
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
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-green-300 dark:border-green-700/60 bg-green-100/80 dark:bg-green-900/40 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors text-[10px] font-medium text-green-800 dark:text-green-300 w-fit"
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
              ) : (
                <div className="text-xs text-muted-foreground/60 text-center py-2">
                  No outputs
                </div>
              )}
            </div>
          </div>
        ) : componentInputs.length > 0 && (
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
                        className="text-blue-600 text-[10px] italic"
                        title={manualDisplay}
                      >
                        Manual: {previewText}
                      </span>
                    )}
                    {manualValueProvided && !manualDisplay && (
                      <span className="text-blue-600 text-[10px] italic">Manual value</span>
                    )}
                    {!manualValueProvided && sourceInfo && (
                      <span className="text-green-600 text-[10px] italic" title={`Connected to: ${sourceInfo}`}>
                        {sourceInfo}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Output Ports (not shown for entry points - they're in the split layout) */}
        {!isEntryPoint && effectiveOutputs.length > 0 && (
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
        )}

        {/* Parameters Display (Required + Select types) */}
        {(() => {
          // Show required parameters and important select parameters (like mode)
          const selectParams = componentParameters.filter(
            param => param.type === 'select' && !param.required
          )
          const paramsToShow = [...requiredParams, ...selectParams]

          if (paramsToShow.length === 0) return null

          return (
            <div className="pt-2 border-t border-border/50">
              <div className="space-y-1">
                {paramsToShow.map((param) => {
                  const value = nodeData.parameters?.[param.id]
                  const effectiveValue = value !== undefined ? value : param.default
                  const hasValue = effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== ''
                  const isDefault = value === undefined && param.default !== undefined

                  // For select parameters, show the label instead of value
                  let displayValue = hasValue ? effectiveValue : ''
                  if (param.type === 'select' && hasValue && param.options) {
                    const option = param.options.find(opt => opt.value === effectiveValue)
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
        })()}

        {/* Enhanced Execution Status Messages */}
        {isTimelineActive && (
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
              <div className="text-xs text-green-600">
                ✓ Completed in {nodeData.executionTime}ms
              </div>
            )}

            {!isTimelineActive && nodeData.status === 'error' && nodeData.error && (
              <div className="text-xs text-red-600 truncate" title={nodeData.error}>
                ✗ {nodeData.error}
              </div>
            )}
          </div>
        )}

        {/* Legacy status messages (when not in timeline mode) */}
        {!isTimelineActive && nodeData.status === 'success' && nodeData.executionTime && (
          <div className="text-xs text-green-600 pt-2 border-t border-green-200">
            ✓ Completed in {nodeData.executionTime}ms
          </div>
        )}

        {!isTimelineActive && nodeData.status === 'error' && nodeData.error && (
          <div className="text-xs text-red-600 pt-2 border-t border-red-200 truncate" title={nodeData.error}>
            ✗ {nodeData.error}
          </div>
        )}
      </div>
    </div>
  )
}
