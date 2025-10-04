import { useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import { ComponentBadge } from '@/components/workflow/ComponentBadge'
import type { ComponentMetadata } from '@/schemas/component'
import { cn } from '@/lib/utils'

const TYPE_CONFIG = {
  input: { label: 'Input', color: 'text-blue-600' },
  scan: { label: 'Security Tools', color: 'text-purple-600' },
  process: { label: 'Processing', color: 'text-green-600' },
  output: { label: 'Output', color: 'text-orange-600' },
} as const

interface ComponentItemProps {
  component: ComponentMetadata
}

function ComponentItem({ component }: ComponentItemProps) {
  const IconComponent = (LucideIcons[component.icon as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>) || LucideIcons.Box

  const onDragStart = (event: React.DragEvent) => {
    // Store component slug for canvas to create node
    event.dataTransfer.setData('application/reactflow', component.slug)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 p-3 border rounded-lg cursor-move',
        'hover:bg-accent hover:border-primary/50 transition-all',
        'bg-background',
        component.deprecated && 'opacity-50'
      )}
      draggable={!component.deprecated}
      onDragStart={onDragStart}
      title={component.description}
    >
      <IconComponent className="h-5 w-5 mt-0.5 flex-shrink-0 text-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium truncate">{component.name}</span>
          {component.author.type === 'shipsector' && (
            <ComponentBadge type="official" />
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {component.description}
        </p>
        {component.deprecated && (
          <div className="mt-2">
            <ComponentBadge type="deprecated" />
          </div>
        )}
      </div>
    </div>
  )
}

export function Sidebar() {
  const { getAllComponents, getComponentsByType, fetchComponents } = useComponentStore()

  // Fetch components on mount
  useEffect(() => {
    fetchComponents()
  }, [fetchComponents])

  const allComponents = getAllComponents()
  const componentsByType = {
    input: getComponentsByType('input'),
    scan: getComponentsByType('scan'),
    process: getComponentsByType('process'),
    output: getComponentsByType('output'),
  }

  return (
    <div className="w-[320px] border-r bg-background overflow-y-auto">
      <div className="p-4">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Components</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Drag and drop to add to workflow
          </p>
        </div>

        {allComponents.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No components available
          </div>
        ) : (
          <div className="space-y-6">
            {(Object.keys(componentsByType) as Array<keyof typeof componentsByType>).map((type) => {
              const components = componentsByType[type]
              if (components.length === 0) return null

              const config = TYPE_CONFIG[type]

              return (
                <div key={type}>
                  <h3 className={cn('text-sm font-semibold mb-3', config.color)}>
                    {config.label}
                  </h3>
                  <div className="space-y-2">
                    {components.map((component) => (
                      <ComponentItem key={component.id} component={component} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Component Count */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            {allComponents.length} component{allComponents.length !== 1 ? 's' : ''} available
          </p>
        </div>
      </div>
    </div>
  )
}
