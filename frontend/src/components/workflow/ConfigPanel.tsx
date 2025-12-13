import * as LucideIcons from 'lucide-react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { X, ExternalLink, Loader2, Trash2, ChevronDown, ChevronRight, Circle, CheckCircle2, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useComponentStore } from '@/store/componentStore'
import { ParameterFieldWrapper } from './ParameterField'
import { SecretSelect } from '@/components/inputs/SecretSelect'
import type { Node } from 'reactflow'
import type { NodeData } from '@/schemas/node'
import type { ComponentType, KeyboardEvent } from 'react'
import {
  describePortDataType,
  inputSupportsManualValue,
  isListOfTextPortDataType,
} from '@/utils/portUtils'
import { API_BASE_URL } from '@/services/api'
import { useWorkflowStore } from '@/store/workflowStore'
import type { WorkflowSchedule } from '@shipsec/shared'

const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint'

interface CollapsibleSectionProps {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleSection({ title, count, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{title}</span>
        </div>
        {count !== undefined && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{count}</Badge>
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t">
          {children}
        </div>
      )}
    </div>
  )
}

interface ConfigPanelProps {
  selectedNode: Node<NodeData> | null
  onClose: () => void
  onUpdateNode?: (nodeId: string, data: Partial<NodeData>) => void
  initialWidth?: number
  onWidthChange?: (width: number) => void
  workflowId?: string | null
  workflowSchedules?: WorkflowSchedule[]
  schedulesLoading?: boolean
  scheduleError?: string | null
  onScheduleCreate?: () => void
  onScheduleEdit?: (schedule: WorkflowSchedule) => void
  onScheduleAction?: (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => Promise<void> | void
  onScheduleDelete?: (schedule: WorkflowSchedule) => Promise<void> | void
  onViewSchedules?: () => void
}

const MIN_PANEL_WIDTH = 280
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 360

const buildSampleValueForRuntimeInput = (type?: string, id?: string) => {
  switch (type) {
    case 'number':
      return 0
    case 'json':
      return { example: true }
    case 'array':
      return ['value-1']
    case 'file':
      return 'upload-file-id'
    case 'text':
    default:
      return id ? `${id}-value` : 'value'
  }
}

const normalizeRuntimeInputs = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const formatScheduleTimestamp = (value?: string | null) => {
  if (!value) return 'Not scheduled'
  try {
    const date = new Date(value)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZoneName: 'short',
    }).format(date)
  } catch {
    return value
  }
}

const scheduleStatusVariant: Record<
  WorkflowSchedule['status'],
  'default' | 'secondary' | 'destructive'
> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
}

interface ManualListChipsInputProps {
  inputId: string
  manualValue: unknown
  disabled: boolean
  placeholder: string
  onChange: (value: string[] | undefined) => void
}

function ManualListChipsInput({
  inputId,
  manualValue,
  disabled,
  placeholder,
  onChange,
}: ManualListChipsInputProps) {
  const listItems = Array.isArray(manualValue)
    ? manualValue.filter((item): item is string => typeof item === 'string')
    : []
  const [draftValue, setDraftValue] = useState('')

  useEffect(() => {
    setDraftValue('')
  }, [manualValue])

  const handleAdd = () => {
    const nextValue = draftValue.trim()
    if (!nextValue) {
      return
    }
    onChange([...listItems, nextValue])
    setDraftValue('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!disabled) {
        handleAdd()
      }
    }
  }

  const handleRemove = (index: number) => {
    if (disabled) return
    const remaining = [...listItems]
    remaining.splice(index, 1)
    onChange(remaining.length > 0 ? remaining : undefined)
  }

  const handleClear = () => {
    if (disabled) return
    onChange(undefined)
  }

  const canAdd = draftValue.trim().length > 0

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={`manual-${inputId}-list`}
          placeholder={placeholder}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="flex-1 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs"
          disabled={disabled || !canAdd}
          onClick={handleAdd}
        >
          Add
        </Button>
      </div>

      {listItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {listItems.map((item, index) => (
            <Badge
              key={`${inputId}-chip-${index}`}
              variant="outline"
              className="gap-1 pr-1"
            >
              <span className="max-w-[160px] truncate">{item}</span>
              {!disabled && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground transition hover:text-foreground hover:bg-muted"
                  onClick={() => handleRemove(index)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {!disabled && listItems.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-fit text-xs px-2"
          onClick={handleClear}
        >
          Clear manual value
        </Button>
      )}
    </div>
  )
}

/**
 * ConfigPanel - Configuration panel for selected workflow node
 *
 * Shows component information and allows editing node parameters
 */
export function ConfigPanel({
  selectedNode,
  onClose,
  onUpdateNode,
  initialWidth = DEFAULT_PANEL_WIDTH,
  onWidthChange,
  workflowId: workflowIdProp,
  workflowSchedules,
  schedulesLoading,
  scheduleError,
  onScheduleCreate,
  onScheduleEdit,
  onScheduleAction,
  onScheduleDelete,
  onViewSchedules,
}: ConfigPanelProps) {
  const { getComponent, loading } = useComponentStore()
  const fallbackWorkflowId = useWorkflowStore((state) => state.metadata.id)
  const workflowId = workflowIdProp ?? fallbackWorkflowId
  const navigate = useNavigate()
  
  const [panelWidth, setPanelWidth] = useState(initialWidth)
  const isResizing = useRef(false)
  const resizeRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const newWidth = window.innerWidth - e.clientX
      const clampedWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, newWidth))
      setPanelWidth(clampedWidth)
      onWidthChange?.(clampedWidth)
    }

    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onWidthChange])

  const handleParameterChange = (paramId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return

    const nodeData = selectedNode.data as any

    const updatedParameters = {
      ...(nodeData.parameters ?? {}),
    }

    if (value === undefined) {
      delete updatedParameters[paramId]
    } else {
      updatedParameters[paramId] = value
    }

    onUpdateNode(selectedNode.id, {
      parameters: updatedParameters,
    })
  }

  if (!selectedNode) {
    return null
  }

  const nodeData = selectedNode.data as any
  const componentRef: string | undefined = nodeData.componentId ?? nodeData.componentSlug
  const component = getComponent(componentRef)

  if (!component) {
    if (loading) {
      return (
        <div className="config-panel border-l bg-background flex flex-col h-full relative" style={{ width: panelWidth }}>
          <div
            ref={resizeRef}
            onMouseDown={handleMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
          />
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-medium text-sm">Configuration</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-sm text-muted-foreground animate-pulse">
              Loading…
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="config-panel border-l bg-background flex flex-col h-full relative" style={{ width: panelWidth }}>
        <div
          ref={resizeRef}
          onMouseDown={handleMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
        />
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-medium text-sm">Configuration</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">Component not found</p>
            <p className="text-xs text-muted-foreground mt-1">{componentRef ?? 'unknown'}</p>
          </div>
        </div>
      </div>
    )
  }

  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box'
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as ComponentType<{ className?: string }>

  const componentInputs = component.inputs ?? []
  const componentOutputs = component.outputs ?? []
  const componentParameters = component.parameters ?? []
  const exampleItems = [
    component.example,
    ...(component.examples ?? []),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))
  const manualParameters = (nodeData.parameters ?? {}) as Record<string, unknown>
  const [scheduleActionState, setScheduleActionState] = useState<Record<string, 'pause' | 'resume' | 'run'>>({})
  const handleNavigateSchedules = useCallback(() => {
    if (!workflowId) {
      navigate('/schedules')
      return
    }
    navigate(`/schedules?workflowId=${workflowId}`)
  }, [navigate, workflowId])
  const viewSchedules = onViewSchedules ?? handleNavigateSchedules
  const schedulesDisabled = !workflowId
  const handleCreateSchedule = useCallback(() => {
    if (schedulesDisabled) {
      viewSchedules()
      return
    }
    if (onScheduleCreate) {
      onScheduleCreate()
    } else {
      viewSchedules()
    }
  }, [onScheduleCreate, schedulesDisabled, viewSchedules])
  const handleEditSchedule = useCallback(
    (schedule: WorkflowSchedule) => {
      if (onScheduleEdit) {
        onScheduleEdit(schedule)
      } else {
        viewSchedules()
      }
    },
    [onScheduleEdit, viewSchedules],
  )
  const handleScheduleActionClick = useCallback(
    async (schedule: WorkflowSchedule, action: 'pause' | 'resume' | 'run') => {
      if (!onScheduleAction) {
        viewSchedules()
        return
      }
      setScheduleActionState((state) => ({ ...state, [schedule.id]: action }))
      try {
        await onScheduleAction(schedule, action)
      } finally {
        setScheduleActionState((state) => {
          const next = { ...state }
          delete next[schedule.id]
          return next
        })
      }
    },
    [onScheduleAction, viewSchedules],
  )
  const isEntryPointComponent = component.id === ENTRY_COMPONENT_ID
  const runtimeInputDefinitions = normalizeRuntimeInputs(manualParameters.runtimeInputs)
  const entryPointPayload = {
    inputs: runtimeInputDefinitions.reduce<Record<string, unknown>>((acc, input: any) => {
      if (input?.id) {
        acc[input.id] = buildSampleValueForRuntimeInput(input.type, input.id)
      }
      return acc
    }, {}),
  }
  const workflowInvokeUrl = workflowId
    ? `${API_BASE_URL}/workflows/${workflowId}/run`
    : `${API_BASE_URL}/workflows/{workflowId}/run`
  const entryPointPayloadString = JSON.stringify(entryPointPayload, null, 2)
  const safeEntryPayload = JSON.stringify(entryPointPayload).replace(/'/g, "\\'")
  const entryPointCurlSnippet = `curl -X POST '${workflowInvokeUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${safeEntryPayload}'`

  return (
    <div className="config-panel border-l bg-background flex flex-col h-full overflow-hidden relative" style={{ width: panelWidth }}>
      {/* Resize Handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-medium text-sm">Configuration</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Component Info */}
      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg border bg-background flex-shrink-0">
            {component.logo ? (
              <img 
                src={component.logo} 
                alt={component.name}
                className="h-6 w-6 object-contain"
                onError={(e) => {
                  // Fallback to icon if image fails to load
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
              />
            ) : null}
            <IconComponent className={cn(
              "h-6 w-6 text-primary",
              component.logo && "hidden"
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm">{component.name}</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {component.description}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-2">
          {/* Inputs Section */}
          {componentInputs.length > 0 && (
            <CollapsibleSection title="Inputs" count={componentInputs.length} defaultOpen={true}>
              <div className="space-y-3 mt-3">
                {componentInputs.map((input) => {
                  const connection = nodeData.inputs?.[input.id]
                  const hasConnection = Boolean(connection)
                  const manualValue = manualParameters[input.id]
                  const manualOverridesPort = input.valuePriority === 'manual-first'
                  const allowsManualInput = inputSupportsManualValue(input) || manualOverridesPort
                  const manualValueProvided =
                    allowsManualInput &&
                    (!hasConnection || manualOverridesPort) &&
                    manualValue !== undefined &&
                    manualValue !== null &&
                    (typeof manualValue === 'string'
                      ? manualValue.trim().length > 0
                      : true)
                  const manualLocked = hasConnection && !manualOverridesPort
                  const primitiveName =
                    input.dataType?.kind === 'primitive' ? input.dataType.name : null
                  const isNumberInput = primitiveName === 'number'
                  const isBooleanInput = primitiveName === 'boolean'
                  const isListOfTextInput = isListOfTextPortDataType(input.dataType)
                  const manualInputValue =
                    manualValue === undefined || manualValue === null
                      ? ''
                      : typeof manualValue === 'string'
                        ? manualValue
                        : String(manualValue)
                  const useSecretSelect =
                    component.id === 'core.secret.fetch' &&
                    input.id === 'secretId'
                  const manualPlaceholder = useSecretSelect
                    ? 'Select a secret...'
                    : input.id === 'supabaseUrl'
                      ? 'https://<project-ref>.supabase.co or <project_ref>'
                      : isNumberInput
                        ? 'Enter a number to use without a connection'
                        : isListOfTextInput
                          ? 'Add entries or press Add to provide a list'
                          : 'Enter text to use without a connection'
                  const typeLabel = describePortDataType(input.dataType)

                  return (
                    <div
                      key={input.id}
                      className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{input.label}</span>
                          {input.required && (
                            <span className="text-[9px] text-destructive font-medium">*</span>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                          {typeLabel}
                        </Badge>
                      </div>
                      {input.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                          {input.description}
                        </p>
                      )}

                      {inputSupportsManualValue(input) && (
                        <div className="mt-2 space-y-1.5">
                          <label
                            htmlFor={`manual-${input.id}`}
                            className="text-[11px] font-medium text-muted-foreground"
                          >
                            Value
                          </label>
                          {useSecretSelect ? (
                            <SecretSelect
                              value={typeof manualValue === 'string' ? manualValue : ''}
                              onChange={(value) => {
                                if (value === '') {
                                  handleParameterChange(input.id, undefined)
                                } else {
                                  handleParameterChange(input.id, value)
                                }
                              }}
                              placeholder={manualPlaceholder}
                              className="text-sm"
                              disabled={manualLocked}
                              allowManualEntry={!manualLocked}
                            />
                          ) : isBooleanInput ? (
                            <div className="space-y-2">
                              <Select
                                value={
                                  typeof manualValue === 'boolean'
                                    ? manualValue
                                      ? 'true'
                                      : 'false'
                                    : undefined
                                }
                                onValueChange={(value) => {
                                  if (value === 'true') {
                                    handleParameterChange(input.id, true)
                                  } else if (value === 'false') {
                                    handleParameterChange(input.id, false)
                                  }
                                }}
                                disabled={manualLocked}
                              >
                                <SelectTrigger className="text-sm">
                                  <SelectValue placeholder="Select true or false" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="true">True</SelectItem>
                                  <SelectItem value="false">False</SelectItem>
                                </SelectContent>
                              </Select>
                              {!manualLocked && typeof manualValue === 'boolean' && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-fit text-xs px-2"
                                  onClick={() => handleParameterChange(input.id, undefined)}
                                >
                                  Clear manual value
                                </Button>
                              )}
                            </div>
                          ) : isListOfTextInput ? (
                            <ManualListChipsInput
                              inputId={input.id}
                              manualValue={manualValue}
                              disabled={manualLocked}
                              placeholder={manualPlaceholder}
                              onChange={(value) => handleParameterChange(input.id, value)}
                            />
                          ) : (
                            <Input
                              id={`manual-${input.id}`}
                              type={isNumberInput ? 'number' : 'text'}
                              value={manualInputValue}
                              onChange={(e) => {
                                const nextValue = e.target.value
                                if (nextValue === '') {
                                  handleParameterChange(input.id, undefined)
                                  return
                                }
                                if (isNumberInput) {
                                  const parsed = Number(nextValue)
                                  if (Number.isNaN(parsed)) {
                                    return
                                  }
                                  handleParameterChange(input.id, parsed)
                                } else {
                                  handleParameterChange(input.id, nextValue)
                                }
                              }}
                              placeholder={manualPlaceholder}
                              className="text-sm"
                              disabled={manualLocked}
                            />
                          )}
                          {manualLocked ? (
                            <p className="text-xs text-muted-foreground italic">
                              Disconnect the port to edit manual input.
                            </p>
                          ) : (
                            <p className="text-[10px] text-muted-foreground">
                              {isBooleanInput
                                ? 'Select a value or clear manual input to require a port connection.'
                                : isListOfTextInput
                                  ? 'Add entries or clear manual input to require a port connection.'
                                  : 'Leave blank to require a port connection.'}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Connection status - compact */}
                      <div className="mt-2 text-[11px]">
                        {manualValueProvided ? (
                          <div className="flex items-center gap-1.5 text-primary">
                            <Circle className="h-2 w-2 fill-current" />
                            <span>Value set</span>
                          </div>
                        ) : hasConnection ? (
                          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Connected from {connection?.source}</span>
                          </div>
                        ) : input.required ? (
                          <div className="flex items-center gap-1.5 text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            <span>Required</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Optional</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Outputs Section */}
          {componentOutputs.length > 0 && (
            <CollapsibleSection title="Outputs" count={componentOutputs.length} defaultOpen={false}>
              <div className="space-y-2 mt-2">
                {componentOutputs.map((output) => (
                  <div
                    key={output.id}
                    className="p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{output.label}</span>
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                        {describePortDataType(output.dataType)}
                      </Badge>
                    </div>
                    {output.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {output.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Parameters Section */}
          {componentParameters.length > 0 && (
            <CollapsibleSection title="Parameters" count={componentParameters.length} defaultOpen={true}>
              <div className="space-y-2 mt-2">
                {/* Sort parameters: select types first, then others */}
                {componentParameters
                  .slice()
                  .sort((a, b) => {
                    // Select parameters go first
                    const aIsSelect = a.type === 'select'
                    const bIsSelect = b.type === 'select'
                    if (aIsSelect && !bIsSelect) return -1
                    if (!aIsSelect && bIsSelect) return 1
                    return 0
                  })
                  .map((param) => (
                    <ParameterFieldWrapper
                      key={param.id}
                      parameter={param}
                      value={nodeData.parameters?.[param.id]}
                      onChange={(value) => handleParameterChange(param.id, value)}
                      connectedInput={nodeData.inputs?.[param.id]}
                      componentId={component.id}
                      parameters={nodeData.parameters}
                      onUpdateParameter={handleParameterChange}
                    />
                  ))}
              </div>
            </CollapsibleSection>
          )}

          {isEntryPointComponent && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div>
                  <h5 className="text-sm font-semibold text-foreground">
                    Invoke via API
                  </h5>
                  <p className="text-xs text-muted-foreground">
                    POST runtime inputs to this endpoint to start the workflow programmatically.
                  </p>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-muted-foreground mb-1">
                    Endpoint
                  </div>
                  <code className="block w-full overflow-x-auto rounded border bg-background px-2 py-1 text-xs font-mono text-foreground break-all">
                    {workflowInvokeUrl}
                  </code>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-muted-foreground mb-1">
                    Payload
                  </div>
                  <pre className="rounded-lg border bg-background px-2 py-2 text-xs font-mono text-foreground overflow-x-auto">
                    {entryPointPayloadString}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] uppercase text-muted-foreground mb-1">
                    curl
                  </div>
                  <pre className="rounded-lg border bg-background px-2 py-2 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
                    {entryPointCurlSnippet}
                  </pre>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-semibold text-foreground">
                      Schedules
                    </h5>
                    <p className="text-xs text-muted-foreground">
                      {workflowId
                        ? 'Create recurring runs and manage Temporal schedules for this workflow.'
                        : 'Save this workflow to start managing schedules.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleCreateSchedule}
                      disabled={schedulesDisabled}
                    >
                      Create schedule
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={viewSchedules}
                    >
                      View all
                    </Button>
                  </div>
                </div>
                {schedulesDisabled ? (
                  <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    Save this workflow to configure schedules.
                  </div>
                ) : schedulesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading schedules…
                  </div>
                ) : scheduleError ? (
                  <div className="rounded border border-dashed border-destructive/50 bg-background/60 px-3 py-2 text-xs text-destructive">
                    {scheduleError}
                  </div>
                ) : workflowSchedules && workflowSchedules.length > 0 ? (
                  <div className="space-y-3">
                    {workflowSchedules.map((schedule) => {
                      const actionLabel =
                        schedule.status === 'active' ? 'Pause' : 'Resume'
                      const actionKey =
                        schedule.status === 'active' ? 'pause' : 'resume'
                      const pendingAction = scheduleActionState[schedule.id]
                      return (
                        <div
                          key={schedule.id}
                          className="rounded-lg border bg-background px-3 py-2 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                  {schedule.name}
                                </span>
                                <Badge
                                  variant={scheduleStatusVariant[schedule.status]}
                                  className="text-[11px] capitalize"
                                >
                                  {schedule.status}
                                </Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Next: {formatScheduleTimestamp(schedule.nextRunAt)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(pendingAction)}
                                onClick={() =>
                                  handleScheduleActionClick(
                                    schedule,
                                    actionKey as 'pause' | 'resume',
                                  )
                                }
                              >
                                {pendingAction === 'pause' ||
                                pendingAction === 'resume' ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                {actionLabel}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={Boolean(pendingAction)}
                                onClick={() =>
                                  handleScheduleActionClick(schedule, 'run')
                                }
                              >
                                Run now
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditSchedule(schedule)}
                              >
                                Edit
                              </Button>
                              {onScheduleDelete && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    if (confirm(`Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`)) {
                                      onScheduleDelete(schedule)
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {schedule.description && (
                            <p className="text-xs text-muted-foreground">
                              {schedule.description}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                    No schedules yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Examples */}
          {exampleItems.length > 0 && (
            <CollapsibleSection title="Examples" count={exampleItems.length} defaultOpen={false}>
              <div className="space-y-2 mt-2">
                {exampleItems.map((exampleText, index) => {
                  const commandMatch = exampleText.match(/`([^`]+)`/)
                  const command = commandMatch?.[1]?.trim()
                  const description = commandMatch
                    ? exampleText
                        .replace(commandMatch[0], '')
                        .replace(/^[\s\u2013\u2014-]+/, '')
                        .trim()
                    : exampleText.trim()

                  return (
                    <div
                      key={`${exampleText}-${index}`}
                      className="p-2.5 rounded-lg border bg-card"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground mt-0.5">
                          {index + 1}.
                        </span>
                        <div className="flex-1 space-y-1.5">
                          {command && (
                            <code className="block w-full overflow-x-auto rounded bg-background px-2 py-1 text-[11px] font-mono">
                              {command}
                            </code>
                          )}
                          {description && (
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Documentation */}
          {(component.documentation || component.documentationUrl) && (
            <CollapsibleSection title="Documentation" defaultOpen={false}>
              <div className="space-y-2 mt-2">
                {component.documentationUrl && (
                  <a
                    href={component.documentationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2.5 rounded-lg border bg-card text-xs hover:bg-muted/50 transition-colors group"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                    <span className="text-muted-foreground group-hover:text-foreground truncate">
                      View docs
                    </span>
                  </a>
                )}
                {component.documentation && (
                  <div className="p-2.5 rounded-lg border bg-card">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {component.documentation}
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono truncate max-w-[140px]" title={selectedNode.id}>
            {selectedNode.id}
          </span>
          <span className="font-mono">{component.slug}</span>
        </div>
      </div>
    </div>
  )
}
