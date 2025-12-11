import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, NodeResizer, Position, type NodeProps, useReactFlow, useUpdateNodeInternals } from 'reactflow'
import { Loader2, CheckCircle, XCircle, Clock, Activity, AlertCircle, Pause, Terminal as TerminalIcon, Pencil } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/ui/markdown'
import { useComponentStore } from '@/store/componentStore'
import { useExecutionStore } from '@/store/executionStore'
import { useExecutionTimelineStore, type NodeVisualState } from '@/store/executionTimelineStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeStyle, getTypeBorderColor } from './nodeStyles'
import { NodeTerminalPanel } from '../terminal/NodeTerminalPanel'
import type { NodeData } from '@/schemas/node'
import type { NodeStatus } from '@/schemas/node'
import type { InputPort } from '@/schemas/component'
import { useWorkflowUiStore } from '@/store/workflowUiStore'
import { inputSupportsManualValue, runtimeInputTypeToPortDataType } from '@/utils/portUtils'

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
  focusedTerminalNodeId,
  bringTerminalToFront,
}: TerminalButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [portalPosition, setPortalPosition] = useState({ top: 0, left: 0 })

  // Update portal position when terminal opens or button moves
  useEffect(() => {
    if (!isTerminalOpen || !buttonRef.current) return

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) {
        // Position above the button, centered
        setPortalPosition({
          top: rect.top - 16, // 16px gap above button
          left: rect.left + rect.width / 2,
        })
      }
    }

    updatePosition()

    // Update position on scroll/resize
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isTerminalOpen])

  return (
    <div className="relative flex justify-center">
      <button
        ref={buttonRef}
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
      {isTerminalOpen &&
        createPortal(
          <div
            className="fixed -translate-x-1/2"
            style={{
              top: portalPosition.top,
              left: portalPosition.left,
              transform: 'translate(-50%, -100%)',
              zIndex: focusedTerminalNodeId === id ? 1070 : 1060,
            }}
          >
            <NodeTerminalPanel
              nodeId={id}
              runId={selectedRunId}
              onClose={() => setIsTerminalOpen(false)}
              timelineSync={mode === 'execution' && (playbackMode !== 'live' || !isLiveFollowing)}
              onFocus={() => bringTerminalToFront(id)}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

/**
 * Enhanced WorkflowNode - Visual representation with timeline states
 */
export const WorkflowNode = memo(({ data, selected, id }: NodeProps<NodeData>) => {
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

    setIsTerminalLoading(true)
    prefetchTerminal(id, 'pty', selectedRunId ?? undefined)
      .catch((error) => {
        console.error('Failed to prefetch terminal output', error)
      })
      .finally(() => setIsTerminalLoading(false))
  }, [id, isTerminalOpen, prefetchTerminal, selectedRunId])

  // Cast to access extended frontend fields (componentId, componentSlug, status, etc.)
  const nodeData = data as any

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

  // Get component metadata
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug
  const component = getComponent(componentRef)
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
      <div className="px-4 py-3 shadow-md rounded-lg border-2 border-red-500 bg-red-50 min-w-[200px]">
        <div className="text-sm text-red-600">
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

  const isTextBlock = component.id === 'core.ui.text'
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
  }, [id, isTextBlock, textSize.width, textSize.height, updateNodeInternals])
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

  // DYNAMIC OUTPUTS: For Manual Trigger, generate outputs based on runtimeInputs parameter
  let effectiveOutputs = component.outputs ?? []
  if (component.id === 'core.trigger.manual' && nodeData.parameters?.runtimeInputs) {
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

  // Determine border color based on validation state (only in design mode)
  const getValidationBorderColor = () => {
    // In execution mode, use status-based colors (handled separately)
    if (mode === 'execution' && selectedRunId) {
      return ''
    }
    
    // If node has execution status, use status-based border
    if (nodeData.status && nodeData.status !== 'idle') {
      return ''
    }
    
    // In design mode, show validation colors
    if (hasUnfilledRequired) {
      return 'border-red-500 border-2'
    }
    
    // Check if node has required fields and all are filled
    const hasRequiredFields = requiredParams.length > 0 || requiredInputs.length > 0
    if (hasRequiredFields && !hasUnfilledRequired) {
      return 'border-green-500 border-2'
    }
    
    // Default visible border for nodes without required fields
    const typeBorderColor = getTypeBorderColor(component.type)
    return `${typeBorderColor} border-2`
  }

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

  const handleResize = (_evt: unknown, params: { width: number; height: number }) => {
    const clampedWidth = clampWidth(params.width)
    const clampedHeight = clampHeight(params.height)
    setTextSize({ width: clampedWidth, height: clampedHeight })
  }

  const handleResizeEnd = (_evt: unknown, params: { width: number; height: number }) => {
    persistSize(params.width, params.height)
  }

  return (
    <div
      className={cn(
        'shadow-lg rounded-lg border-2 transition-all relative',
        isTextBlock ? 'min-w-[240px] max-w-none flex flex-col' : 'min-w-[240px] max-w-[280px]',
        // Enhanced border styling for timeline
        isTimelineActive && effectiveStatus === 'running' && 'border-blue-400',
        isTimelineActive && effectiveStatus === 'running' && !isPlaying && 'border-dashed',
        isTimelineActive && effectiveStatus === 'error' && 'border-red-400 bg-red-50/20',
        isTimelineActive && effectiveStatus === 'success' && 'border-green-400 bg-green-50/20',

        // Existing styling
        nodeData.status ? nodeStyle.border : getTypeBorderColor(component.type),
        nodeData.status && nodeData.status !== 'idle'
          ? nodeStyle.bg
          : isTimelineActive && visualState.status === 'running'
            ? 'bg-blue-50/80 dark:bg-blue-900/30'
            : 'bg-background',
        selected && 'ring-2 ring-blue-500 ring-offset-2',
        
        // Validation styling (only when not in execution mode)
        !isTimelineActive && hasUnfilledRequired && !nodeData.status && 'shadow-red-100',
        getValidationBorderColor(),

        // Interactive states - use CSS hover to avoid re-renders
        'hover:shadow-xl hover:scale-[1.02]',
        selectedRunId && 'cursor-pointer'
      )}
      ref={nodeRef}
      onClick={() => selectedRunId && selectNode(id)}
      style={
        isTextBlock
          ? {
              width: Math.max(MIN_TEXT_WIDTH, textSize.width ?? DEFAULT_TEXT_WIDTH),
              minHeight: Math.max(MIN_TEXT_HEIGHT, textSize.height ?? DEFAULT_TEXT_HEIGHT),
            }
          : undefined
      }
    >
      {isTextBlock && mode === 'design' && (
        <NodeResizer
          minWidth={MIN_TEXT_WIDTH}
          maxWidth={MAX_TEXT_WIDTH}
          minHeight={MIN_TEXT_HEIGHT}
          maxHeight={MAX_TEXT_HEIGHT}
          isVisible
          handleStyle={{
            width: 12,
            height: 12,
            borderRadius: 4,
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--muted))',
          }}
          lineStyle={{ borderColor: 'hsl(var(--border))' }}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50 relative">
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
                    onClick={() => {
                      // Don't stop propagation - let React Flow handle the selection
                      // This will select the node and open the config panel
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
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
        {/* Input Ports */}
        {componentInputs.length > 0 && (
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

        {/* Output Ports */}
        {effectiveOutputs.length > 0 && (
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
                                  ? "text-blue-600 bg-blue-50 font-semibold"
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
})
