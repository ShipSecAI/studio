import { useEffect, useMemo } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type RuntimeInputType = 'file' | 'text' | 'number' | 'json' | 'array' | 'string'
type NormalizedRuntimeInputType = Exclude<RuntimeInputType, 'string'>

const normalizeRuntimeInputType = (type: RuntimeInputType): NormalizedRuntimeInputType =>
  type === 'string' ? 'text' : type

interface RuntimeInput {
  id: string
  label: string
  type: RuntimeInputType
  required: boolean
  description?: string
}

interface RuntimeInputsEditorProps {
  value: RuntimeInput[]
  onChange: (value: RuntimeInput[]) => void
}

export function RuntimeInputsEditor({ value, onChange }: RuntimeInputsEditorProps) {
  const rawInputs = Array.isArray(value) ? value : []
  const normalizedInputs = useMemo(
    () => rawInputs.map(input => ({
      ...input,
      type: normalizeRuntimeInputType(input.type),
    })),
    [rawInputs],
  )

  const hasLegacyType = useMemo(
    () => rawInputs.some(input => input.type === 'string'),
    [rawInputs],
  )

  useEffect(() => {
    if (hasLegacyType) {
      onChange(normalizedInputs)
    }
  }, [hasLegacyType, normalizedInputs, onChange])

  const inputs = normalizedInputs

  const addInput = () => {
    const newInput: RuntimeInput = {
      id: `input${inputs.length + 1}`,
      label: `Input ${inputs.length + 1}`,
      type: 'array',
      required: true,
      description: '',
    }
    onChange([...inputs, newInput])
  }

  const removeInput = (index: number) => {
    const newInputs = inputs.filter((_, i) => i !== index)
    onChange(newInputs)
  }

  const updateInput = (index: number, field: keyof RuntimeInput, fieldValue: any) => {
    const newInputs = [...inputs]
    newInputs[index] = { ...newInputs[index], [field]: fieldValue }
    onChange(newInputs)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Runtime Inputs</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addInput}
          className="h-7 text-xs gap-1"
        >
          <Plus className="h-3 w-3" />
          Add Input
        </Button>
      </div>

      {inputs.length === 0 ? (
        <div className="p-6 border-2 border-dashed rounded-lg text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No runtime inputs configured
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Runtime inputs allow users to provide data when the workflow is triggered.
            Each input creates a corresponding output port.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addInput}
            className="gap-1"
          >
            <Plus className="h-3 w-3" />
            Add First Input
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {inputs.map((input, index) => (
            <div
              key={index}
              className="p-3 border rounded-lg bg-background space-y-3"
            >
              {/* Header with drag handle and delete */}
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                <span className="text-sm font-medium flex-1">
                  Input {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeInput(index)}
                >
                  <Trash2 className="h-3 w-3 text-red-500" />
                </Button>
              </div>

              {/* ID Field */}
              <div className="space-y-1">
                <Label htmlFor={`input-${index}-id`} className="text-xs">
                  ID <span className="text-red-500">*</span>
                </Label>
                <Input
                  id={`input-${index}-id`}
                  value={input.id}
                  onChange={(e) => updateInput(index, 'id', e.target.value)}
                  placeholder="e.g., uploadedFile"
                  className="h-8 text-xs font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Unique identifier for this input (will be used as output port ID)
                </p>
              </div>

              {/* Label Field */}
              <div className="space-y-1">
                <Label htmlFor={`input-${index}-label`} className="text-xs">
                  Label <span className="text-red-500">*</span>
                </Label>
                <Input
                  id={`input-${index}-label`}
                  value={input.label}
                  onChange={(e) => updateInput(index, 'label', e.target.value)}
                  placeholder="e.g., Input File"
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Display name shown to users
                </p>
              </div>

              {/* Type Dropdown */}
              <div className="space-y-1">
                <Label htmlFor={`input-${index}-type`} className="text-xs">
                  Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={input.type}
                  onValueChange={(value) => updateInput(index, 'type', value as RuntimeInput['type'])}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    <SelectItem value="file">File Upload</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="array">Array</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Data type for this input
                </p>
              </div>

              {/* Description Field */}
              <div className="space-y-1">
                <Label htmlFor={`input-${index}-description`} className="text-xs">
                  Description
                </Label>
                <Input
                  id={`input-${index}-description`}
                  value={input.description || ''}
                  onChange={(e) => updateInput(index, 'description', e.target.value)}
                  placeholder="Optional help text"
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Help text shown to users (optional)
                </p>
              </div>

              {/* Required Checkbox */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`input-${index}-required`}
                  checked={input.required}
                  onCheckedChange={(checked) => updateInput(index, 'required', checked === true)}
                />
                <Label
                  htmlFor={`input-${index}-required`}
                  className="text-xs font-normal cursor-pointer"
                >
                  Required input
                </Label>
              </div>

              {/* Output Port Preview */}
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-muted-foreground">
                    Output port: <span className="font-mono text-green-600">{input.id}</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      {inputs.length > 0 && (
        <div className="p-3 bg-muted/50 rounded-lg border">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{inputs.length}</span> runtime input
            {inputs.length !== 1 ? 's' : ''} configured
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {inputs.length} output port{inputs.length !== 1 ? 's' : ''} will be created on this node
          </p>
        </div>
      )}
    </div>
  )
}
