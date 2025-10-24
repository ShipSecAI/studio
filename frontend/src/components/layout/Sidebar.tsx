import { useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import type { ComponentMetadata } from '@/schemas/component'
import { cn } from '@/lib/utils'
import { env } from '@/config/env'

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
        'group relative flex items-center gap-3 p-3 border rounded-lg cursor-move',
        'hover:bg-accent hover:border-primary/50 transition-all text-left',
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate flex-1">{component.name}</span>
          {component.version && (
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide shrink-0">
              v{component.version}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {description}
        </p>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { getAllComponents, getComponentsByType, fetchComponents, loading, error } = useComponentStore()
  const frontendBranch = env.VITE_FRONTEND_BRANCH.trim()
  const backendBranch = env.VITE_BACKEND_BRANCH.trim()
  const hasBranchInfo = Boolean(frontendBranch || backendBranch)

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
    <div className="h-full w-full max-w-[320px] border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold">Components</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drag and drop to add to workflow
        </p>
        {hasBranchInfo && (
          <div className="mt-2 space-y-1">
            {frontendBranch && (
              <p className="text-xs text-muted-foreground">Frontend branch: {frontendBranch}</p>
            )}
            {backendBranch && (
              <p className="text-xs text-muted-foreground">Backend branch: {backendBranch}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
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

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                {allComponents.length} component{allComponents.length !== 1 ? 's' : ''} available
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
