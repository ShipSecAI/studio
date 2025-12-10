import { useEffect, useState, useMemo } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import { Input } from '@/components/ui/input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import type { ComponentMetadata } from '@/schemas/component'
import { cn } from '@/lib/utils'
import { env } from '@/config/env'
import { Skeleton } from '@/components/ui/skeleton'

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
        'group relative flex flex-col p-3 border border-border/50 rounded-lg cursor-move transition-all',
        'bg-background/50 hover:bg-background hover:border-border',
        'text-foreground aspect-[4/3]',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:shadow-sm hover:scale-[1.02]',
        component.deprecated && 'opacity-50'
      )}
      draggable={!component.deprecated && !disabled}
      onDragStart={onDragStart}
    >
      {/* Default: Centered icon and name */}
      <div className="flex flex-col items-center justify-center gap-2 flex-1 group-hover:hidden transition-all">
        {component.logo ? (
          <img 
            src={component.logo} 
            alt={component.name}
            className="h-8 w-8 flex-shrink-0 object-contain"
            onError={(e) => {
              // Fallback to icon if image fails to load
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <IconComponent className={cn(
          "h-8 w-8 flex-shrink-0 text-muted-foreground",
          component.logo && "hidden"
        )} />
        <span className="text-[13px] font-semibold leading-tight text-center line-clamp-2">
          {component.name}
        </span>
      </div>

      {/* Hover: Icon left, name right, description below */}
      <div className="hidden group-hover:flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2.5">
          {component.logo ? (
            <img 
              src={component.logo} 
              alt={component.name}
              className="h-6 w-6 flex-shrink-0 object-contain"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <IconComponent className={cn(
            "h-6 w-6 flex-shrink-0 text-muted-foreground",
            component.logo && "hidden"
          )} />
          <span className="text-[13px] font-semibold leading-[1.3] line-clamp-2 flex-1 -mt-0.5">
            {component.name}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-3 leading-snug">
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

  // Group components by backend-provided categories (memoized to prevent infinite loops)
  const componentsByCategory = useMemo(() => {
    return allComponents.reduce((acc, component) => {
      const category = component.category
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(component)
      return acc
    }, {} as Record<string, ComponentMetadata[]>)
  }, [allComponents])

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

  // Track open accordion items (controlled)
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([])

  // Track whether we've initialized the accordion with the first category
  const [hasInitialized, setHasInitialized] = useState(false)

  // Initialize accordion to first category when components first load
  useEffect(() => {
    if (!hasInitialized && !searchQuery.trim()) {
      const categories = Object.keys(filteredComponentsByCategory)
      if (categories.length > 0) {
        setOpenAccordionItems([categories[0]])
        setHasInitialized(true)
      }
    }
  }, [filteredComponentsByCategory, hasInitialized, searchQuery])

  // Auto-expand all matching categories when search query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      // When searching, open all categories that have matching components
      setOpenAccordionItems(Object.keys(filteredComponentsByCategory))
    } else if (hasInitialized) {
      // When clearing search, open only the first category
      const categories = Object.keys(filteredComponentsByCategory)
      setOpenAccordionItems(categories.length > 0 ? [categories[0]] : [])
    }
    // Only depend on searchQuery - not filteredComponentsByCategory to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  return (
    <div className="h-full w-full max-w-[320px] border-r bg-background flex flex-col">
      <div className="p-4 border-b space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Components</h2>
          {/* <p className="text-xs text-muted-foreground mt-1">
            Drag and drop to add to workflow
          </p> */}
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

      <div className="flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
        {loading ? (
          <div className="space-y-0">
            <div>
              <div className="py-3">
                <Skeleton className="h-4 w-24 mb-2" />
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="rounded-lg p-3 bg-background/50">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-5 w-5 rounded" />
                            <Skeleton className="h-3 w-16" />
                          </div>
                          <Skeleton className="h-3 w-6" />
                        </div>
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
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
          <div className="space-y-2">
            {/* Search results message */}
            {searchQuery.trim() && (
              <div className="text-xs text-muted-foreground px-0.5 pb-1">
                Found {Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0)}
                {Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0) !== 1 ? ' components' : ' component'}{' '}
                matching "{searchQuery}"
              </div>
            )}

            {Object.keys(filteredComponentsByCategory).length > 0 && (
            <Accordion 
              type="multiple" 
              className="space-y-2" 
              value={openAccordionItems}
              onValueChange={setOpenAccordionItems}
            >
              {Object.entries(filteredComponentsByCategory).map(([category, components]) => {
                if (components.length === 0) return null

                const categoryConfig = components[0]?.categoryConfig

                return (
                  <AccordionItem 
                    key={category} 
                    value={category} 
                    className="border border-border/50 rounded-sm px-3 py-1 hover:bg-muted/50 transition-colors"
                  >
                    <AccordionTrigger className={cn(
                      'py-3 px-0 hover:no-underline [&[data-state=open]]:text-foreground',
                      'group'
                    )}>
                      <div className="flex flex-col items-start gap-0.5 w-full">
                        <div className="flex items-center justify-between w-full">
                          <h3 className={cn(
                            'text-sm font-semibold transition-colors',
                            categoryConfig?.color || 'text-foreground'
                          )}>
                            {categoryConfig?.label ?? category}
                          </h3>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-3 px-0">
                      <div className="grid grid-cols-2 gap-2">
                        {components.map((component) => (
                          <ComponentItem
                            key={component.id}
                            component={component}
                            disabled={!canManageWorkflows}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
            )}

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

            <div className="pt-2 border-t mt-2">
              <p className="text-xs text-muted-foreground px-0.5">
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
