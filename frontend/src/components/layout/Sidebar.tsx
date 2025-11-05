import { useEffect, useState, useMemo } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import { Input } from '@/components/ui/input'
import type { ComponentMetadata } from '@/schemas/component'
import { cn } from '@/lib/utils'
import { env } from '@/config/env'

// Use backend-provided category configuration
// The frontend will no longer categorize components - it will use backend data

interface ComponentItemProps {
  component: ComponentMetadata
  disabled?: boolean
}

function ComponentItem({ component, disabled }: ComponentItemProps) {
  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box'
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>
  const description = component.description || 'No description available yet.'

  const onDragStart = (event: React.DragEvent) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    // Store component ID for canvas to create node
    event.dataTransfer.setData('application/reactflow', component.id)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 p-3 border rounded-lg cursor-move',
        disabled
          ? 'cursor-not-allowed opacity-75'
          : 'hover:bg-accent hover:border-primary/50',
        'transition-all text-left',
        'bg-background',
        component.deprecated && 'opacity-50'
      )}
      draggable={!component.deprecated && !disabled}
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

interface SidebarProps {
  canManageWorkflows?: boolean
}

export function Sidebar({ canManageWorkflows = true }: SidebarProps) {
  const { getAllComponents, fetchComponents, loading, error } = useComponentStore()
  const [searchQuery, setSearchQuery] = useState('')
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

  // Group components by backend-provided categories
  const componentsByCategory = allComponents.reduce((acc, component) => {
    const category = component.category
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(component)
    return acc
  }, {} as Record<string, ComponentMetadata[]>)

  // Filter components based on search query
  const filteredComponentsByCategory = useMemo(() => {
    if (!searchQuery.trim()) {
      return componentsByCategory
    }

    const query = searchQuery.toLowerCase()
    const filtered = {} as Record<string, ComponentMetadata[]>

    Object.entries(componentsByCategory).forEach(([category, components]) => {
      const firstComponent = components[0]
      const categoryConfig = firstComponent?.categoryConfig

      // Check if category name matches the search query
      const label = categoryConfig?.label?.toLowerCase()
      const desc = categoryConfig?.description?.toLowerCase()
      const categoryMatches =
        (label && label.includes(query)) ||
        (desc && desc.includes(query)) ||
        category.toLowerCase().includes(query)

      // Filter components within this category
      const matchingComponents = components.filter(component =>
        component.name.toLowerCase().includes(query) ||
        component.description?.toLowerCase().includes(query) ||
        component.id.toLowerCase().includes(query)
      )

      // Include category if either category name matches or components within it match
      if (categoryMatches || matchingComponents.length > 0) {
        filtered[category] = matchingComponents
      }
    })

    return filtered
  }, [componentsByCategory, searchQuery])

  return (
    <div className="h-full w-full max-w-[320px] border-r bg-background flex flex-col">
      <div className="p-4 border-b space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Components</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Drag and drop to add to workflow
          </p>
        </div>

        <div className="relative">
          <Input
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-sm"
          />
        </div>

        {hasBranchInfo && (
          <div className="space-y-1">
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
            {/* Search results message */}
            {searchQuery.trim() && (
              <div className="text-xs text-muted-foreground">
                Found {Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0)}
                {Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0) !== 1 ? ' components' : ' component'}
                matching "{searchQuery}"
              </div>
            )}

            <div className="space-y-6">
              {Object.entries(filteredComponentsByCategory).map(([category, components]) => {
                if (components.length === 0) return null

                const categoryConfig = components[0]?.categoryConfig

                return (
                  <div key={category}>
                    <div className="mb-3">
                      <h3 className={cn('text-sm font-semibold', categoryConfig?.color || 'text-gray-600')}>
                        {categoryConfig?.label ?? category}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {categoryConfig?.description ?? `${category} components`}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {components.map((component) => (
                        <ComponentItem
                          key={component.id}
                          component={component}
                          disabled={!canManageWorkflows}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Show no results message if search yields nothing */}
            {searchQuery.trim() && Object.values(filteredComponentsByCategory).every(components => components.length === 0) && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  No components found matching "{searchQuery}"
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Try different keywords or clear the search
                </p>
              </div>
            )}

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                {searchQuery.trim()
                  ? `${Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0)} of ${allComponents.length} component${allComponents.length !== 1 ? 's' : ''} shown`
                  : `${allComponents.length} component${allComponents.length !== 1 ? 's' : ''} available`
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
