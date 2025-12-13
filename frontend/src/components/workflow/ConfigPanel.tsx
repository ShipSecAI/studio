import { X, ExternalLink, Loader2, Trash2 } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
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

interface ConfigPanelProps {
  selectedNode: Node<NodeData> | null
  onClose: () => void
  onUpdateNode?: (nodeId: string, data: Partial<NodeData>) => void
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

const formatManualValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch (error) {
    console.error('Failed to serialise manual value for preview', error)
    return String(value)
  }
}

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
        <div className="w-[360px] border-l bg-background flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Configuration</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 p-4">
            <div className="text-sm text-muted-foreground">
              Loading component metadata…
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="w-[360px] border-l bg-background flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Configuration</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 p-4">
          <div className="text-sm text-red-600">
            Component not found: {componentRef ?? 'unknown'}
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
    <div className="config-panel w-[400px] border-l bg-background flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">Configuration</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Component Info */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-background border">
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
              "h-6 w-6",
              component.logo && "hidden"
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm truncate mb-1">{component.name}</h4>
            <p className="text-xs text-muted-foreground mb-2">
              {component.description}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* Inputs Section */}
          {componentInputs.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold mb-3 text-foreground">Inputs</h5>
              <div className="space-y-3">
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
                  const manualValuePreview = formatManualValue(manualValue)
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
                      className="p-3 rounded-lg border bg-background"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{input.label}</span>
                        {input.required && (
                          <span className="text-xs text-red-500">*required</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Type: <span className="font-mono">{typeLabel}</span>
                      </div>
                      {input.description && (
                        <p className="text-xs text-muted-foreground">
                          {input.description}
                        </p>
                      )}

                      {inputSupportsManualValue(input) && (
                        <div className="mt-2 space-y-1">
                          <label
                            htmlFor={`manual-${input.id}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            Manual value
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

                      {/* Connection status */}
                      <div className="mt-2 pt-2 border-t">
                        <div className="text-xs space-y-1">
                          {manualValueProvided ? (
                            <>
                              <div className="text-blue-600 flex items-center gap-1">
                                • <span className="font-medium">Manual value in use</span>
                              </div>
                              {inputSupportsManualValue(input) && manualValuePreview && (
                                <div className="text-muted-foreground break-words">
                                  Value:{' '}
                                  <span className="font-mono text-blue-600">
                                    {manualValuePreview}
                                  </span>
                                </div>
                              )}
                              {hasConnection ? (
                                <div className="text-muted-foreground">
                                  Manual override active even though a port is connected. Clear the manual value to use{' '}
                                  <span className="font-mono text-blue-600">
                                    {connection?.source}.{connection?.output}
                                  </span>.
                                </div>
                              ) : (
                                <div className="text-muted-foreground">
                                  No connection required while a manual value is set.
                                </div>
                              )}
                            </>
                          ) : hasConnection ? (
                            <div className="space-y-1">
                              <div className="text-green-600 flex items-center gap-1">
                                ✓ <span className="font-medium">Connected</span>
                              </div>
                              <div className="text-muted-foreground">
                                Source:{' '}
                                <span className="font-mono text-blue-600">
                                  {connection?.source}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                Output:{' '}
                                <span className="font-mono text-blue-600">
                                  {connection?.output}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                Port input overrides manual values while connected.
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              {input.required ? (
                                <span className="text-red-500">
                                  ⚠ <span className="font-medium">Required but not connected</span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  Optional input – connect a port or provide a manual value.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Outputs Section */}
          {componentOutputs.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold mb-3 text-foreground">Outputs</h5>
              <div className="space-y-3">
                {componentOutputs.map((output) => (
                  <div
                    key={output.id}
                    className="p-3 rounded-lg border bg-background"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{output.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Type: <span className="font-mono">{describePortDataType(output.dataType)}</span>
                    </div>
                    {output.description && (
                      <p className="text-xs text-muted-foreground">
                        {output.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parameters Section */}
          {componentParameters.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold mb-3 text-foreground">
                Parameters
              </h5>
              <div className="space-y-3">
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
            </div>
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
            <div>
              <h5 className="text-sm font-semibold mb-3 text-foreground">
                Examples
              </h5>
              <div className="space-y-3">
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
                      className="p-3 rounded-lg border bg-muted/40"
                    >
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-[11px] font-medium text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="flex-1 space-y-2">
                          {command && (
                            <code className="block w-full overflow-x-auto rounded border bg-background px-2 py-1 text-[11px] font-mono text-foreground">
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
            </div>
          )}

          {/* Documentation */}
          {(component.documentation || component.documentationUrl) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-semibold text-foreground">
                  Documentation
                </h5>
                {component.documentationUrl && (
                  <a
                    href={component.documentationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <span>View docs</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="space-y-2">
                {component.documentationUrl && (
                  <a
                    href={component.documentationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 p-3 rounded-lg border bg-muted/50 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <span className="break-all text-left">{component.documentationUrl}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
                {component.documentation && (
                  <div className="p-3 rounded-lg border bg-muted/50">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {component.documentation}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Node ID: {selectedNode.id}</span>
          <span>{component.slug}</span>
        </div>
      </div>
    </div>
  )
}
