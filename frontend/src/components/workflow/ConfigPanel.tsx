import { X, ExternalLink } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useComponentStore } from '@/store/componentStore'
import { ComponentMetadataSummary } from './ComponentBadge'
import { ParameterFieldWrapper } from './ParameterField'
import type { Node } from 'reactflow'
import type { NodeData } from '@/schemas/node'

interface ConfigPanelProps {
  selectedNode: Node<NodeData> | null
  onClose: () => void
  onUpdateNode?: (nodeId: string, data: Partial<NodeData>) => void
}

/**
 * ConfigPanel - Configuration panel for selected workflow node
 *
 * Shows component information and allows editing node parameters
 */
export function ConfigPanel({ selectedNode, onClose, onUpdateNode }: ConfigPanelProps) {
  const { getComponent, loading } = useComponentStore()

  const handleParameterChange = (paramId: string, value: any) => {
    if (!selectedNode || !onUpdateNode) return

    const nodeData = selectedNode.data as any

    const updatedParameters = {
      ...nodeData.parameters,
      [paramId]: value,
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
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>

  const componentInputs = component.inputs ?? []
  const componentParameters = component.parameters ?? []
  const exampleItems = [
    component.example,
    ...(component.examples ?? []),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))

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
            <ComponentMetadataSummary
              component={component}
              compact
              className="mb-2"
            />
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
                {componentInputs.map((input) => (
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
                      Type: <span className="font-mono">{input.type}</span>
                    </div>
                    {input.description && (
                      <p className="text-xs text-muted-foreground">
                        {input.description}
                      </p>
                    )}
                    {/* Connection status */}
                    <div className="mt-2 pt-2 border-t">
                      <div className="text-xs">
                        {nodeData.inputs?.[input.id] ? (
                          <div className="space-y-1">
                            <div className="text-green-600 flex items-center gap-1">
                              ✓ <span className="font-medium">Connected</span>
                            </div>
                            <div className="text-muted-foreground">
                              Source: <span className="font-mono text-blue-600">
                                {nodeData.inputs[input.id].source}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Output: <span className="font-mono">
                                {nodeData.inputs[input.id].output}
                              </span>
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
                                ○ <span className="font-medium">Not connected (optional)</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
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
                {componentParameters.map((param) => (
                  <ParameterFieldWrapper
                    key={param.id}
                    parameter={param}
                    value={nodeData.parameters?.[param.id]}
                    onChange={(value) => handleParameterChange(param.id, value)}
                  />
                ))}
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
              {component.documentation && (
                <div className="p-3 rounded-lg border bg-muted/50">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {component.documentation}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Node ID: {selectedNode.id}</span>
          <span>v{component.version}</span>
        </div>
      </div>
    </div>
  )
}
