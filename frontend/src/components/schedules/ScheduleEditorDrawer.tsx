import { useEffect, useMemo, useState } from 'react'
import type { components } from '@shipsec/backend-client'
import type { WorkflowSchedule, ScheduleOverlapPolicy } from '@shipsec/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'

const ENTRY_COMPONENT_ID = 'core.workflow.entrypoint'

type WorkflowResponseDto = components['schemas']['WorkflowResponseDto']

type RuntimeInputType = 'file' | 'text' | 'number' | 'json' | 'array' | 'string'
type NormalizedRuntimeInputType = Exclude<RuntimeInputType, 'string'>

export interface RuntimeInputDefinition {
  id: string
  label: string
  type: RuntimeInputType
  required: boolean
  description?: string
  defaultValue?: unknown
}

export interface WorkflowOption {
  id: string
  name: string
}

type ScheduleEditorMode = 'create' | 'edit'

interface ScheduleEditorDrawerProps {
  open: boolean
  mode: ScheduleEditorMode
  schedule?: WorkflowSchedule | null
  defaultWorkflowId?: string | null
  workflowOptions: WorkflowOption[]
  onClose: () => void
  onSaved?: (schedule: WorkflowSchedule, mode: ScheduleEditorMode) => void
}

interface ScheduleFormState {
  workflowId: string
  name: string
  description: string
  cronExpression: string
  timezone: string
  humanLabel: string
  overlapPolicy: ScheduleOverlapPolicy
  catchupWindowSeconds: string
}

interface OverrideDraft {
  [nodeId: string]: string
}

const OVERLAP_OPTIONS: {
  value: ScheduleOverlapPolicy
  label: string
  description: string
}[] = [
  {
    value: 'skip',
    label: 'Skip overlapping runs',
    description: 'New runs are skipped when the previous run is still executing.',
  },
  {
    value: 'buffer',
    label: 'Buffer until available',
    description: 'Backlog queued runs and execute sequentially when workers free up.',
  },
  {
    value: 'allow',
    label: 'Allow overlap',
    description: 'Always start the run even when previous executions are in-flight.',
  },
]

const getLocalTimezone = (): string => {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone
    return resolved ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

const normalizeRuntimeInputs = (value: unknown): RuntimeInputDefinition[] => {
  if (Array.isArray(value)) {
    return value as RuntimeInputDefinition[]
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as RuntimeInputDefinition[]) : []
    } catch {
      return []
    }
  }
  return []
}

const normalizeRuntimeInputType = (
  type: RuntimeInputType,
): NormalizedRuntimeInputType => (type === 'string' ? 'text' : type)

const toOverrideDrafts = (
  overrides: Record<string, Record<string, unknown>> | undefined,
): OverrideDraft => {
  if (!overrides) {
    return {}
  }
  return Object.entries(overrides).reduce<OverrideDraft>((acc, [nodeId, value]) => {
    acc[nodeId] = JSON.stringify(value, null, 2)
    return acc
  }, {})
}

const ENTRY_SECTION_COPY =
  'Configure how this workflow should run on a cadence. Provide runtime inputs for the Entry Point and optional node overrides before saving the schedule.'

export function ScheduleEditorDrawer({
  open,
  mode,
  schedule,
  defaultWorkflowId,
  workflowOptions,
  onClose,
  onSaved,
}: ScheduleEditorDrawerProps) {
  const [form, setForm] = useState<ScheduleFormState>(() => ({
    workflowId: '',
    name: '',
    description: '',
    cronExpression: '0 9 * * *',
    timezone: getLocalTimezone(),
    humanLabel: '',
    overlapPolicy: 'skip',
    catchupWindowSeconds: '0',
  }))
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowResponseDto | null>(null)
  const [workflowCache, setWorkflowCache] = useState<Record<string, WorkflowResponseDto>>({})
  const [workflowLoading, setWorkflowLoading] = useState(false)
  const [runtimeInputs, setRuntimeInputs] = useState<RuntimeInputDefinition[]>([])
  const [runtimeValues, setRuntimeValues] = useState<Record<string, unknown>>({})
  const [runtimeErrors, setRuntimeErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [nodeOverridesDraft, setNodeOverridesDraft] = useState<OverrideDraft>({})
  const [nodeOverrideErrors, setNodeOverrideErrors] = useState<Record<string, string>>({})
  const [pendingOverrideNode, setPendingOverrideNode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formSeed, setFormSeed] = useState(0)

  const resetForm = () => {
    const baseWorkflowId =
      mode === 'edit' && schedule
        ? schedule.workflowId
        : (defaultWorkflowId ?? schedule?.workflowId ?? '')
    setForm({
      workflowId: baseWorkflowId,
      name: schedule?.name ?? '',
      description: schedule?.description ?? '',
      cronExpression: schedule?.cronExpression ?? '0 9 * * *',
      timezone: schedule?.timezone ?? getLocalTimezone(),
      humanLabel: schedule?.humanLabel ?? '',
      overlapPolicy: schedule?.overlapPolicy ?? 'skip',
      catchupWindowSeconds: String(schedule?.catchupWindowSeconds ?? 0),
    })
    setRuntimeValues(schedule?.inputPayload.runtimeInputs ?? {})
    setRuntimeErrors({})
    setUploading({})
    setNodeOverridesDraft(toOverrideDrafts(schedule?.inputPayload.nodeOverrides))
    setNodeOverrideErrors({})
    setPendingOverrideNode('')
    setFormError(null)
    setFormSeed((seed) => seed + 1)
    if (!baseWorkflowId) {
      setWorkflowDetail(null)
      setRuntimeInputs([])
    }
  }

  useEffect(() => {
    if (open) {
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, schedule, defaultWorkflowId])

  const selectedWorkflow = useMemo(
    () => workflowOptions.find((workflow) => workflow.id === form.workflowId) ?? null,
    [workflowOptions, form.workflowId],
  )

  useEffect(() => {
    if (!open) return
    if (!form.workflowId) {
      setWorkflowDetail(null)
      setRuntimeInputs([])
      return
    }
    const cached = workflowCache[form.workflowId]
    if (cached) {
      setWorkflowDetail(cached)
      setRuntimeInputs(normalizeRuntimeInputs(cached.graph.nodes.find(
        (node) => node.type === ENTRY_COMPONENT_ID,
      )?.data?.config?.runtimeInputs))
      return
    }
    let cancelled = false
    setWorkflowLoading(true)
    ;(async () => {
      try {
        const detail = await api.workflows.get(form.workflowId)
        if (cancelled) return
        setWorkflowCache((prev) => ({ ...prev, [detail.id]: detail }))
        setWorkflowDetail(detail)
        const entryNode = detail.graph.nodes.find(
          (node) => node.type === ENTRY_COMPONENT_ID,
        )
        setRuntimeInputs(normalizeRuntimeInputs(entryNode?.data?.config?.runtimeInputs))
      } catch (error) {
        if (!cancelled) {
          setFormError(
            error instanceof Error
              ? error.message
              : 'Unable to load workflow details',
          )
          setWorkflowDetail(null)
          setRuntimeInputs([])
        }
      } finally {
        if (!cancelled) {
          setWorkflowLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [form.workflowId, open, workflowCache])

  const workflowNodes = useMemo(() => {
    if (!workflowDetail) return []
    return workflowDetail.graph.nodes.filter(
      (node) => node.type !== ENTRY_COMPONENT_ID,
    )
  }, [workflowDetail])

  const availableOverrideNodes = useMemo(() => {
    const selected = new Set(Object.keys(nodeOverridesDraft))
    return workflowNodes.filter((node) => !selected.has(node.id))
  }, [nodeOverridesDraft, workflowNodes])

  const handleFieldChange = <K extends keyof ScheduleFormState>(
    key: K,
    value: ScheduleFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleRuntimeInputChange = (
    input: RuntimeInputDefinition,
    value: unknown,
  ) => {
    const inputType = normalizeRuntimeInputType(input.type)
    setRuntimeErrors((prev) => {
      const next = { ...prev }
      delete next[input.id]
      return next
    })

    let parsedValue: unknown = value
    if (inputType === 'number') {
      const numeric = value ? Number(value) : undefined
      parsedValue = Number.isFinite(numeric) ? numeric : undefined
    } else if (inputType === 'array') {
      const textValue = typeof value === 'string' ? value : ''
      const trimmed = textValue.trim()
      if (trimmed.length === 0) {
        parsedValue = undefined
      } else {
        try {
          const parsed = JSON.parse(trimmed)
          parsedValue = Array.isArray(parsed) ? parsed : trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
        } catch {
          parsedValue = trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
        }
      }
    } else if (inputType === 'json') {
      try {
        parsedValue = value ? JSON.parse(String(value)) : undefined
      } catch {
        setRuntimeErrors((prev) => ({
          ...prev,
          [input.id]: 'Invalid JSON value',
        }))
        return
      }
    }

    setRuntimeValues((prev) => ({
      ...prev,
      [input.id]: parsedValue,
    }))
  }

  const handleFileUpload = async (inputId: string, file: File) => {
    setUploading((prev) => ({ ...prev, [inputId]: true }))
    setRuntimeErrors((prev) => {
      const next = { ...prev }
      delete next[inputId]
      return next
    })
    try {
      const fileData = await api.files.upload(file)
      setRuntimeValues((prev) => ({ ...prev, [inputId]: fileData.id }))
    } catch (error) {
      setRuntimeErrors((prev) => ({
        ...prev,
        [inputId]:
          error instanceof Error ? error.message : 'File upload failed',
      }))
    } finally {
      setUploading((prev) => ({ ...prev, [inputId]: false }))
    }
  }

  const addOverrideNode = () => {
    if (!pendingOverrideNode) return
    setNodeOverridesDraft((prev) => ({
      ...prev,
      [pendingOverrideNode]: nodeOverridesDraft[pendingOverrideNode] ?? '{\n}',
    }))
    setPendingOverrideNode('')
  }

  const removeOverrideNode = (nodeId: string) => {
    setNodeOverridesDraft((prev) => {
      const next = { ...prev }
      delete next[nodeId]
      return next
    })
    setNodeOverrideErrors((prev) => {
      const next = { ...prev }
      delete next[nodeId]
      return next
    })
  }

  const handleOverrideChange = (nodeId: string, value: string) => {
    setNodeOverridesDraft((prev) => ({ ...prev, [nodeId]: value }))
    if (!value.trim()) {
      setNodeOverrideErrors((prev) => {
        const next = { ...prev }
        delete next[nodeId]
        return next
      })
      return
    }
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setNodeOverrideErrors((prev) => {
          const next = { ...prev }
          delete next[nodeId]
          return next
        })
      } else {
        setNodeOverrideErrors((prev) => ({
          ...prev,
          [nodeId]: 'Provide a JSON object',
        }))
      }
    } catch {
      setNodeOverrideErrors((prev) => ({
        ...prev,
        [nodeId]: 'Invalid JSON object',
      }))
    }
  }

  const normalizeRuntimeValues = () => {
    return Object.entries(runtimeValues).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        if (value === undefined || value === null || value === '') {
          return acc
        }
        acc[key] = value
        return acc
      },
      {},
    )
  }

  const parseNodeOverrides = () => {
    return Object.entries(nodeOverridesDraft).reduce<
      Record<string, Record<string, unknown>>
    >((acc, [nodeId, value]) => {
      const trimmed = value.trim()
      if (!trimmed) {
        return acc
      }
      const parsed = JSON.parse(trimmed)
      acc[nodeId] = parsed as Record<string, unknown>
      return acc
    }, {})
  }

  const validateRequiredInputs = () => {
    const missing: Record<string, string> = {}
    for (const input of runtimeInputs) {
      if (!input.required) continue
      const hasValue = runtimeValues[input.id] !== undefined && runtimeValues[input.id] !== null && runtimeValues[input.id] !== ''
      if (!hasValue) {
        missing[input.id] = 'This field is required'
      }
    }
    if (Object.keys(missing).length > 0) {
      setRuntimeErrors(missing)
      return false
    }
    return true
  }

  const handleSubmit = async () => {
    if (!form.workflowId) {
      setFormError('Select a workflow before continuing.')
      return
    }
    if (!form.name.trim()) {
      setFormError('Provide a schedule name.')
      return
    }
    if (!form.cronExpression.trim()) {
      setFormError('Provide a cron expression.')
      return
    }
    if (!form.timezone.trim()) {
      setFormError('Provide a timezone (e.g., UTC or America/New_York).')
      return
    }
    if (!validateRequiredInputs()) {
      return
    }
    if (Object.keys(nodeOverrideErrors).length > 0) {
      setFormError('Resolve node override errors before saving.')
      return
    }
    setFormError(null)
    const payload = {
      workflowId: form.workflowId,
      name: form.name.trim(),
      description: form.description.trim().length > 0 ? form.description.trim() : undefined,
      cronExpression: form.cronExpression.trim(),
      timezone: form.timezone.trim(),
      humanLabel: form.humanLabel.trim().length > 0 ? form.humanLabel.trim() : undefined,
      overlapPolicy: form.overlapPolicy,
      catchupWindowSeconds: Number(form.catchupWindowSeconds) || 0,
      inputPayload: {
        runtimeInputs: normalizeRuntimeValues(),
        nodeOverrides: parseNodeOverrides(),
      },
    }
    setSubmitting(true)
    try {
      const saved =
        mode === 'create'
          ? await api.schedules.create(payload)
          : await api.schedules.update(schedule!.id, payload)
      onSaved?.(saved, mode)
      onClose()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Failed to save schedule',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const renderRuntimeInputField = (input: RuntimeInputDefinition) => {
    const type = normalizeRuntimeInputType(input.type)
    const error = runtimeErrors[input.id]
    const uploadingState = uploading[input.id]
    const currentValue = runtimeValues[input.id]
    switch (type) {
      case 'file':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id} className="text-sm font-medium">
              {input.label}
              {input.required ? <span className="text-red-500 ml-1">*</span> : null}
            </Label>
            <Input
              id={input.id}
              type="file"
              disabled={uploadingState}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handleFileUpload(input.id, file)
                }
              }}
            />
            {uploadingState ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading file…
              </p>
            ) : null}
            {currentValue && typeof currentValue === 'string' ? (
              <p className="text-xs text-emerald-600 font-mono break-all">
                Stored file ID: {currentValue}
              </p>
            ) : null}
            {input.description ? (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            ) : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
          </div>
        )
      case 'json':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id} className="text-sm font-medium">
              {input.label}
              {input.required ? <span className="text-red-500 ml-1">*</span> : null}
            </Label>
            <Textarea
              id={input.id}
              rows={4}
              className={cn('font-mono', error && 'border-red-500')}
              defaultValue={
                typeof currentValue === 'string'
                  ? currentValue
                  : currentValue != null
                  ? JSON.stringify(currentValue, null, 2)
                  : ''
              }
              onBlur={(event) => handleRuntimeInputChange(input, event.target.value)}
            />
            {input.description ? (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            ) : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
          </div>
        )
      case 'array':
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id} className="text-sm font-medium">
              {input.label}
              {input.required ? <span className="text-red-500 ml-1">*</span> : null}
            </Label>
            <Textarea
              id={input.id}
              rows={3}
              className={cn('font-mono', error && 'border-red-500')}
              placeholder='["value-1", "value-2"] or comma-separated text'
              defaultValue={
                typeof currentValue === 'string'
                  ? currentValue
                  : Array.isArray(currentValue)
                  ? JSON.stringify(currentValue)
                  : ''
              }
              onBlur={(event) => handleRuntimeInputChange(input, event.target.value)}
            />
            {input.description ? (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            ) : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
          </div>
        )
      default:
        return (
          <div className="space-y-2">
            <Label htmlFor={input.id} className="text-sm font-medium">
              {input.label}
              {input.required ? <span className="text-red-500 ml-1">*</span> : null}
            </Label>
            <Input
              id={input.id}
              type={type === 'number' ? 'number' : 'text'}
              defaultValue={
                typeof currentValue === 'string' || typeof currentValue === 'number'
                  ? String(currentValue)
                  : ''
              }
              className={error ? 'border-red-500' : ''}
              placeholder={type === 'number' ? '0' : undefined}
              onBlur={(event) => handleRuntimeInputChange(input, event.target.value)}
            />
            {input.description ? (
              <p className="text-xs text-muted-foreground">{input.description}</p>
            ) : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
          </div>
        )
    }
  }

  const runtimeSection = (() => {
    if (!form.workflowId) {
      return (
        <p className="text-sm text-muted-foreground">
          Select a workflow above to load its Entry Point inputs.
        </p>
      )
    }
    if (workflowLoading) {
      return (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Entry Point inputs…
        </p>
      )
    }
    if (runtimeInputs.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          This workflow does not define runtime inputs. Scheduled runs will execute without additional payload.
        </p>
      )
    }
    return (
      <div className="grid gap-4">
        {runtimeInputs.map((input) => (
          <div key={`${input.id}-${formSeed}`}>
            {renderRuntimeInputField(input)}
          </div>
        ))}
      </div>
    )
  })()

  const nodeOverrideSection = (
    <div className="space-y-3">
      {Object.entries(nodeOverridesDraft).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Workflow nodes will appear here so you can override parameters when this schedule runs.
        </p>
      ) : (
        Object.entries(nodeOverridesDraft).map(([nodeId, draftValue]) => {
          const node = workflowNodes.find((candidate) => candidate.id === nodeId)
          const label = node?.data?.label ?? nodeId
          const error = nodeOverrideErrors[nodeId]
          return (
            <div key={nodeId} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{nodeId}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => removeOverrideNode(nodeId)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
              <Textarea
                rows={4}
                className={cn('font-mono', error && 'border-red-500')}
                value={draftValue}
                onChange={(event) => handleOverrideChange(nodeId, event.target.value)}
                placeholder='{"parameter": "value"}'
              />
              {error ? <p className="text-xs text-red-500">{error}</p> : null}
            </div>
          )
        })
      )}
      {workflowNodes.length > 0 && availableOverrideNodes.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select
            value={pendingOverrideNode || 'select-node'}
            onValueChange={(value) => {
              if (value === 'select-node') return
              setPendingOverrideNode(value)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select node to override" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="select-node" disabled>
                Select node
              </SelectItem>
              {availableOverrideNodes.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.data?.label ?? node.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={!pendingOverrideNode}
            onClick={addOverrideNode}
          >
            <Plus className="h-4 w-4" />
            Add override
          </Button>
        </div>
      ) : null}
      {workflowNodes.length > 0 &&
      Object.keys(nodeOverridesDraft).length === 0 &&
      availableOverrideNodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every workflow node already has overrides attached to this schedule.
        </p>
      ) : null}
    </div>
  )

  const workflowDisabled = mode === 'edit'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create schedule' : 'Edit schedule'}
          </DialogTitle>
          <DialogDescription>{ENTRY_SECTION_COPY}</DialogDescription>
        </DialogHeader>

        <div className="space-y-8 py-2">
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Workflow</Label>
                <Select
                  value={form.workflowId || 'none'}
                  disabled={workflowDisabled || workflowOptions.length === 0}
                  onValueChange={(value) => {
                    if (value === 'none') {
                      handleFieldChange('workflowId', '')
                      return
                    }
                    handleFieldChange('workflowId', value)
                    setRuntimeValues({})
                    setNodeOverridesDraft({})
                    setNodeOverrideErrors({})
                    setRuntimeErrors({})
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>
                      Select workflow
                    </SelectItem>
                    {workflowOptions.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedWorkflow ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedWorkflow.name}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Choose which workflow this cadence should invoke.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Schedule name</Label>
                <Input
                  value={form.name}
                  onChange={(event) => handleFieldChange('name', event.target.value)}
                  placeholder="Daily quick scan"
                />
                <p className="text-xs text-muted-foreground">
                  Appears in run metadata and chips inside the workflow.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Description</Label>
              <Textarea
                value={form.description}
                onChange={(event) => handleFieldChange('description', event.target.value)}
                rows={3}
                placeholder="Optional context for other operators."
              />
            </div>
          </section>

          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Cron expression</Label>
                <Input
                  value={form.cronExpression}
                  onChange={(event) =>
                    handleFieldChange('cronExpression', event.target.value)
                  }
                  placeholder="0 9 * * MON-FRI"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Use standard cron syntax. Temporal handles catch-up windows.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Timezone</Label>
                <Input
                  value={form.timezone}
                  onChange={(event) => handleFieldChange('timezone', event.target.value)}
                  placeholder="UTC or America/New_York"
                />
                <p className="text-xs text-muted-foreground">
                  Provide an IANA timezone identifier.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Friendly label</Label>
                <Input
                  value={form.humanLabel}
                  onChange={(event) => handleFieldChange('humanLabel', event.target.value)}
                  placeholder="Weekday mornings"
                />
                <p className="text-xs text-muted-foreground">
                  Optional alias shown beside the cron string.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Overlap policy</Label>
                <Select
                  value={form.overlapPolicy}
                  onValueChange={(value) =>
                    handleFieldChange('overlapPolicy', value as ScheduleOverlapPolicy)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OVERLAP_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Catch-up window (seconds)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.catchupWindowSeconds}
                  onChange={(event) =>
                    handleFieldChange('catchupWindowSeconds', event.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How long Temporal should keep missed runs queued.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Entry Point inputs</h3>
                <p className="text-xs text-muted-foreground">
                  Provide the payload this schedule should reuse each time it runs.
                </p>
              </div>
              {runtimeInputs.length > 0 ? (
                <Badge variant="outline">{runtimeInputs.length} inputs</Badge>
              ) : null}
            </div>
            {runtimeSection}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Node overrides</h3>
                <p className="text-xs text-muted-foreground">
                  Override component parameters for this schedule without touching the workflow graph.
                </p>
              </div>
              <Badge variant="outline">
                {Object.keys(nodeOverridesDraft).length} overrides
              </Badge>
            </div>
            {nodeOverrideSection}
          </section>

          {formError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {formError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.workflowId}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </>
            ) : (
              'Save schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
