import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { RuntimeInputsEditor } from './RuntimeInputsEditor'
import type { Parameter } from '@/schemas/component'

interface ParameterFieldProps {
  parameter: Parameter
  value: any
  onChange: (value: any) => void
}

/**
 * ParameterField - Renders appropriate input field based on parameter type
 */
export function ParameterField({ parameter, value, onChange }: ParameterFieldProps) {
  const currentValue = value !== undefined ? value : parameter.default
  const [jsonText, setJsonText] = useState<string>('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    if (parameter.type !== 'json') {
      return
    }

    if (value === undefined || value === null || value === '') {
      setJsonText('')
      setJsonError(null)
      return
    }

    if (typeof value === 'string') {
      setJsonText(value)
      setJsonError(null)
      return
    }

    try {
      setJsonText(JSON.stringify(value, null, 2))
      setJsonError(null)
    } catch (error) {
      console.error('Failed to serialise JSON parameter value', error)
    }
  }, [parameter.type, value])

  switch (parameter.type) {
    case 'text':
      return (
        <Input
          id={parameter.id}
          type="text"
          placeholder={parameter.placeholder}
          value={currentValue || ''}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm"
        />
      )

    case 'textarea':
      return (
        <textarea
          id={parameter.id}
          placeholder={parameter.placeholder}
          value={currentValue || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={parameter.rows || 3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono"
        />
      )

    case 'number':
      return (
        <Input
          id={parameter.id}
          type="number"
          placeholder={parameter.placeholder}
          value={currentValue ?? ''}
          onChange={(e) => {
            const inputValue = e.target.value
            if (inputValue === '') {
              onChange(undefined)
              return
            }
            onChange(Number(inputValue))
          }}
          min={parameter.min}
          max={parameter.max}
          className="text-sm"
        />
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={parameter.id}
            checked={currentValue || false}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <label
            htmlFor={parameter.id}
            className="text-sm text-muted-foreground cursor-pointer select-none"
          >
            {currentValue ? 'Enabled' : 'Disabled'}
          </label>
        </div>
      )

    case 'select':
      return (
        <select
          id={parameter.id}
          value={currentValue || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        >
          {!parameter.required && !parameter.default && (
            <option value="">Select an option...</option>
          )}
          {parameter.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )

    case 'multi-select':
      const selectedValues = Array.isArray(currentValue) ? currentValue : []
      return (
        <div className="space-y-2">
          {parameter.options?.map((option) => {
            const isSelected = selectedValues.includes(option.value)
            return (
              <div
                key={option.value}
                className="flex items-center gap-2 hover:bg-muted/50 p-2 rounded transition-colors"
              >
                <Checkbox
                  id={`${parameter.id}-${option.value}`}
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    const newValues = checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter((v) => v !== option.value)
                    onChange(newValues)
                  }}
                />
                <label
                  htmlFor={`${parameter.id}-${option.value}`}
                  className="text-sm select-none cursor-pointer flex-1"
                >
                  {option.label}
                </label>
              </div>
            )
          })}
          {selectedValues.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedValues.map((val) => {
                const option = parameter.options?.find((o) => o.value === val)
                return (
                  <Badge key={val} variant="secondary" className="text-xs">
                    {option?.label || val}
                  </Badge>
                )
              })}
            </div>
          )}
        </div>
      )

    case 'file':
      return (
        <div className="space-y-2">
          <Input
            id={parameter.id}
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                onChange(file.name)
              }
            }}
            className="text-sm"
          />
          {currentValue && (
            <div className="text-xs text-muted-foreground">
              Selected: <span className="font-mono">{currentValue}</span>
            </div>
          )}
        </div>
      )

    case 'json':
      return (
        <div className="space-y-2">
          <textarea
            id={parameter.id}
            value={jsonText}
            onChange={(e) => {
              const nextValue = e.target.value
              setJsonText(nextValue)

              if (nextValue.trim() === '') {
                setJsonError(null)
                onChange(undefined)
                return
              }

              try {
                const parsed = JSON.parse(nextValue)
                setJsonError(null)
                onChange(parsed)
              } catch (error) {
                setJsonError('Invalid JSON')
              }
            }}
            className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-y font-mono"
            rows={parameter.rows || 4}
            placeholder={parameter.placeholder || '{\n  "key": "value"\n}'}
          />
          {jsonError && (
            <p className="text-xs text-red-500">{jsonError}</p>
          )}
        </div>
      )

    default:
      return (
        <div className="text-xs text-muted-foreground italic">
          Unsupported parameter type: {parameter.type}
        </div>
      )
  }
}

interface ParameterFieldWrapperProps {
  parameter: Parameter
  value: any
  onChange: (value: any) => void
}

/**
 * ParameterFieldWrapper - Wraps parameter field with label and description
 */
export function ParameterFieldWrapper({
  parameter,
  value,
  onChange,
}: ParameterFieldWrapperProps) {
  // Special case: Runtime Inputs Editor for Manual Trigger
  if (parameter.id === 'runtimeInputs') {
    return (
      <div className="p-3 rounded-lg border bg-background space-y-2">
        {parameter.description && (
          <p className="text-xs text-muted-foreground mb-2">
            {parameter.description}
          </p>
        )}

        <RuntimeInputsEditor value={value || []} onChange={onChange} />

        {parameter.helpText && (
          <p className="text-xs text-muted-foreground italic mt-2">
            💡 {parameter.helpText}
          </p>
        )}
      </div>
    )
  }

  // Standard parameter field rendering
  return (
    <div className="p-3 rounded-lg border bg-background space-y-2">
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium" htmlFor={parameter.id}>
          {parameter.label}
        </label>
        {parameter.required && (
          <span className="text-xs text-red-500">*required</span>
        )}
      </div>

      {parameter.description && (
        <p className="text-xs text-muted-foreground mb-2">
          {parameter.description}
        </p>
      )}

      <ParameterField parameter={parameter} value={value} onChange={onChange} />

      {parameter.helpText && (
        <p className="text-xs text-muted-foreground italic mt-2">
          💡 {parameter.helpText}
        </p>
      )}
    </div>
  )
}
