import { useEffect, useState } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import { ComponentBadge } from '@/components/workflow/ComponentBadge'
import { FileUpload } from '@/components/workflow/FileUpload'
import type { ComponentMetadata } from '@/schemas/component'
import { cn } from '@/lib/utils'

const TYPE_CONFIG = {
  trigger: { label: 'Triggers', color: 'text-gray-500' },
  input: { label: 'Inputs', color: 'text-blue-600' },
  scan: { label: 'Security Tools', color: 'text-purple-600' },
  process: { label: 'Processing', color: 'text-green-600' },
  output: { label: 'Outputs', color: 'text-orange-600' },
} as const satisfies Record<string, { label: string; color: string }>

interface ComponentItemProps {
  component: ComponentMetadata
}

function ComponentItem({ component }: ComponentItemProps) {
  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box'
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>
  const description = component.description || 'No description available yet.'

  const onDragStart = (event: React.DragEvent) => {
    // Store component ID for canvas to create node
    event.dataTransfer.setData('application/reactflow', component.id)
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
      title={description}
    >
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
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium truncate">{component.name}</span>
          {component.author?.type === 'shipsecai' && (
            <ComponentBadge type="official" />
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {description}
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
  const { getAllComponents, getComponentsByType, fetchComponents, loading, error } = useComponentStore()
  const [showFileUpload, setShowFileUpload] = useState(false)

  // Fetch components on mount
  useEffect(() => {
    fetchComponents().catch((error) => {
      console.error('Failed to load components', error)
    })
  }, [fetchComponents])

  const allComponents = getAllComponents()
  const componentsByType = {
    trigger: getComponentsByType('trigger'),
    input: getComponentsByType('input'),
    scan: getComponentsByType('scan'),
    process: getComponentsByType('process'),
    output: getComponentsByType('output'),
  }

  return (
    <div className="w-full max-w-[320px] border-r bg-background overflow-y-auto flex flex-col">
      <div className="p-4 flex-1">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">Components</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Drag and drop to add to workflow
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Loading components...
          </div>
        ) : error ? (
          <div className="text-sm text-red-500 text-center py-8">
            Failed to load components: {error}
          </div>
        ) : allComponents.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No components available
          </div>
        ) : (
          <div className="space-y-6">
            {(Object.keys(componentsByType) as Array<keyof typeof componentsByType>).map((type) => {
              const components = componentsByType[type]
              if (components.length === 0) return null

              const config = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG]
              if (!config) return null

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

      {/* File Upload Section */}
      <div className="p-4 border-t bg-muted/50">
        <button
          onClick={() => setShowFileUpload(!showFileUpload)}
          className="w-full flex items-center justify-between mb-2"
        >
          <div className="flex items-center gap-2">
            <LucideIcons.Upload className="h-4 w-4" />
            <h3 className="text-sm font-semibold">File Upload</h3>
          </div>
          {showFileUpload ? (
            <LucideIcons.ChevronUp className="h-4 w-4" />
          ) : (
            <LucideIcons.ChevronDown className="h-4 w-4" />
          )}
        </button>
        
        {showFileUpload && (
          <div className="mt-2">
            <FileUpload
              onFileUploaded={(fileId, fileName) => {
                console.log('File uploaded:', fileId, fileName)
                // Could show a success toast here
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
