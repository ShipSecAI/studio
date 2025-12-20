import { useEffect, useState, useMemo, useRef } from 'react'
import * as LucideIcons from 'lucide-react'
import { useComponentStore } from '@/store/componentStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
import {
  type ComponentCategory,
  getCategorySeparatorColor
} from '@/utils/categoryColors'
import { useThemeStore } from '@/store/themeStore'
import { useWorkflowUiStore } from '@/store/workflowUiStore'

// Use backend-provided category configuration
// The frontend will no longer categorize components - it will use backend data

type ViewMode = 'list' | 'tiles'

// Global state for mobile component placement (shared between Sidebar and Canvas)
export const mobilePlacementState = {
  componentId: null as string | null,
  componentName: null as string | null,
  isActive: false, // True when a component is selected and waiting to be placed
  onSidebarClose: null as (() => void) | null, // Callback to close sidebar
}

// Function to set the sidebar close callback
export const setMobilePlacementSidebarClose = (callback: () => void) => {
  mobilePlacementState.onSidebarClose = callback
}

// Function to clear the placement state
export const clearMobilePlacement = () => {
  mobilePlacementState.componentId = null
  mobilePlacementState.componentName = null
  mobilePlacementState.isActive = false
}

interface ComponentItemProps {
  component: ComponentMetadata
  disabled?: boolean
  viewMode: ViewMode
}

function ComponentItem({ component, disabled, viewMode }: ComponentItemProps) {
  const iconName = component.icon && component.icon in LucideIcons ? component.icon : 'Box'
  const IconComponent = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>
  const description = component.description || 'No description available yet.'
  const [isSelected, setIsSelected] = useState(false)

  const onDragStart = (event: React.DragEvent) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    // Store component ID for canvas to create node
    event.dataTransfer.setData('application/reactflow', component.id)
    event.dataTransfer.effectAllowed = 'move'
  }

  // Handle tap on mobile - select component and close sidebar
  const handleTap = () => {
    if (disabled || component.deprecated) return

    // Set the component for placement
    mobilePlacementState.componentId = component.id
    mobilePlacementState.componentName = component.name
    mobilePlacementState.isActive = true
    setIsSelected(true)

    // Close sidebar after a short delay to show selection feedback
    setTimeout(() => {
      // Close the library panel directly via store
      useWorkflowUiStore.getState().setLibraryOpen(false)
      setIsSelected(false)
    }, 150)
  }

  // Clear selection if this component is no longer the active one
  useEffect(() => {
    if (mobilePlacementState.componentId !== component.id) {
      setIsSelected(false)
    }
  }, [component.id])

  if (viewMode === 'list') {
    return (
      <div
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-all',
          'hover:bg-muted/50 border border-border/30 hover:border-border/60',
          'md:cursor-move', // Desktop: show move cursor
          disabled
            ? 'cursor-not-allowed opacity-50'
            : '',
          component.deprecated && 'opacity-50',
          isSelected && 'bg-primary/20 border-primary scale-95'
        )}
        draggable={!component.deprecated && !disabled}
        onDragStart={onDragStart}
        onClick={handleTap}
      >
        {/* Icon */}
        <div className="flex-shrink-0">
          {component.logo ? (
            <img
              src={component.logo}
              alt={component.name}
              className="h-5 w-5 object-contain"
              onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none'
                e.currentTarget.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <IconComponent className={cn(
            "h-5 w-5 text-muted-foreground flex-shrink-0",
            component.logo && "hidden"
          )} />
        </div>

        {/* Title and description */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <span className="block text-sm font-medium leading-tight truncate">
            {component.name}
          </span>
          {description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
    )
  }

  // Tile view
  return (
    <div
      className={cn(
        'group relative flex flex-col p-3 border border-border/50 rounded-lg cursor-pointer transition-all',
        'bg-background/50 hover:bg-background hover:border-border',
        'text-foreground aspect-[4/3]',
        'md:cursor-move', // Desktop: show move cursor
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:shadow-sm hover:scale-[1.02]',
        component.deprecated && 'opacity-50',
        isSelected && 'bg-primary/20 border-primary scale-95'
      )}
      draggable={!component.deprecated && !disabled}
      onDragStart={onDragStart}
      onClick={handleTap}
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
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const theme = useThemeStore((state) => state.theme)
  const isDarkMode = theme === 'dark'
  const frontendBranch = env.VITE_FRONTEND_BRANCH.trim()
  const backendBranch = env.VITE_BACKEND_BRANCH.trim()
  const hasBranchInfo = Boolean(frontendBranch || backendBranch)

  // Get category accent color (for left border) - uses separator colors for brightness
  const getCategoryAccentColor = (category: string): string | undefined => {
    return getCategorySeparatorColor(category as ComponentCategory, isDarkMode)
  }

  // Get category text color with good contrast in both light and dark modes
  const getCategoryTextColor = (category: string): string => {
    const categoryColors: Record<string, string> = {
      input: 'text-blue-600 dark:text-blue-400',
      transform: 'text-orange-600 dark:text-orange-400',
      ai: 'text-purple-600 dark:text-purple-400',
      security: 'text-red-600 dark:text-red-400',
      it_ops: 'text-cyan-600 dark:text-cyan-400',
      output: 'text-green-600 dark:text-green-400',
    }
    return categoryColors[category] || 'text-foreground'
  }

  // Custom scrollbar state
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollbarVisible, setScrollbarVisible] = useState(false)
  const [scrollbarPosition, setScrollbarPosition] = useState(0)
  const [scrollbarHeight, setScrollbarHeight] = useState(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isScrollingRef = useRef(false)

  // Fetch components on mount
  useEffect(() => {
    fetchComponents().catch((error) => {
      console.error('Failed to load components', error)
    })
  }, [fetchComponents])

  const showDemoComponents = useWorkflowUiStore((state) => state.showDemoComponents)
  const allComponents = getAllComponents()

  // Helper to identify demo components
  const isDemoComponent = (component: ComponentMetadata) => {
    const name = component.name.toLowerCase()
    const slug = component.slug.toLowerCase()
    const category = component.category.toLowerCase()

    return (
      category === 'demo' ||
      name.includes('demo') ||
      slug.includes('demo') ||
      name.includes('(test)') ||
      name === 'live event' ||
      name === 'parallel sleep' ||
      slug === 'live-event' ||
      slug === 'parallel-sleep'
    )
  }

  // Filter out entry point component (always present, shouldn't be in the list)
  const filteredComponents = useMemo(() => {
    return allComponents.filter(
      component => {
        if (component.id === 'core.workflow.entrypoint' || component.slug === 'entry-point') {
          return false
        }
        if (!env.VITE_ENABLE_IT_OPS && component.category === 'it_ops') {
          return false
        }
        // Hide demo components unless toggled on via special keypress
        if (!showDemoComponents && isDemoComponent(component)) {
          return false
        }
        return true
      }
    )
  }, [allComponents, showDemoComponents])

  // Group components by backend-provided categories (memoized to prevent infinite loops)
  const componentsByCategory = useMemo(() => {
    return filteredComponents.reduce((acc, component) => {
      const category = component.category
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(component)
      return acc
    }, {} as Record<string, ComponentMetadata[]>)
  }, [filteredComponents])

  // Category display order
  const categoryOrder = ['input', 'output', 'security', 'ai', 'transform', 'it_ops'] as const

  // Filter components based on search query
  const filteredComponentsByCategory = useMemo(() => {
    const filtered = searchQuery.trim() ? (() => {
      const query = searchQuery.toLowerCase()
      const result = {} as Record<string, ComponentMetadata[]>

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
          result[category] = matchingComponents
        }
      })

      return result
    })() : componentsByCategory

    // Sort categories by predefined order
    const sortedEntries = Object.entries(filtered).sort(([a], [b]) => {
      const indexA = categoryOrder.indexOf(a as typeof categoryOrder[number])
      const indexB = categoryOrder.indexOf(b as typeof categoryOrder[number])
      // If category not in order list, put it at the end
      if (indexA === -1 && indexB === -1) return 0
      if (indexA === -1) return 1
      if (indexB === -1) return -1
      return indexA - indexB
    })

    return Object.fromEntries(sortedEntries)
  }, [componentsByCategory, searchQuery])

  // Track open accordion items (controlled)
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([])

  // Track whether we've initialized the accordion
  const [hasInitialized, setHasInitialized] = useState(false)

  // Initialize accordion: open all categories by default for better discoverability
  useEffect(() => {
    if (!hasInitialized && !searchQuery.trim()) {
      const categories = Object.keys(filteredComponentsByCategory)
      if (categories.length > 0) {
        // Open all categories by default
        setOpenAccordionItems(categories)
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
      // When clearing search, open all categories again
      const categories = Object.keys(filteredComponentsByCategory)
      setOpenAccordionItems(categories.length > 0 ? categories : [])
    }
    // Only depend on searchQuery - not filteredComponentsByCategory to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Custom scrollbar logic - setup event listeners (only once)
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const updateScrollbar = (showImmediately = false) => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const maxScroll = scrollHeight - clientHeight

      if (maxScroll <= 0) {
        setScrollbarVisible(false)
        return
      }

      // Calculate scrollbar thumb position and height
      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 30)
      const thumbPosition = (scrollTop / maxScroll) * (clientHeight - thumbHeight)

      setScrollbarHeight(thumbHeight)
      setScrollbarPosition(thumbPosition)

      // Only show scrollbar when actively scrolling or explicitly requested
      if (showImmediately || isScrollingRef.current) {
        setScrollbarVisible(true)
      }

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      // Hide scrollbar after scrolling stops
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false
        setScrollbarVisible(false)
      }, 800)
    }

    const handleScroll = () => {
      isScrollingRef.current = true
      updateScrollbar(true)
    }

    const handleResize = () => {
      updateScrollbar(false)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleResize)

    // Initial check - don't show scrollbar on mount
    updateScrollbar(false)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleResize)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
    // Only setup event listeners once - don't depend on content changes
  }, [])

  // Update scrollbar when content changes (without re-setting up listeners)
  // Calculate a stable value for component count to use as dependency
  const componentCount = useMemo(() => {
    return Object.values(filteredComponentsByCategory).reduce(
      (total, components) => total + components.length,
      0
    )
  }, [filteredComponentsByCategory])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Use requestAnimationFrame to ensure DOM has updated after content changes
    requestAnimationFrame(() => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const maxScroll = scrollHeight - clientHeight

      if (maxScroll <= 0) {
        setScrollbarVisible(false)
        setScrollbarHeight(0)
        setScrollbarPosition(0)
        return
      }

      // Calculate scrollbar thumb position and height
      const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, 30)
      const thumbPosition = (scrollTop / maxScroll) * (clientHeight - thumbHeight)

      setScrollbarHeight(thumbHeight)
      setScrollbarPosition(thumbPosition)
      // Don't show scrollbar automatically when content changes - only on scroll
    })
  }, [componentCount, loading]) // Use stable componentCount instead of filteredComponentsByCategory object

  return (
    <div className="h-full w-full max-w-[320px] border-r bg-background flex flex-col">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold leading-none">Components</h2>
          <div className="flex items-center gap-0.5 border border-border/50 rounded-md p-0.5 h-7">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-6 px-2',
                viewMode === 'list' && 'bg-muted'
              )}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <LucideIcons.List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === 'tiles' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-6 px-2',
                viewMode === 'tiles' && 'bg-muted'
              )}
              onClick={() => setViewMode('tiles')}
              title="Tile view"
            >
              <LucideIcons.Grid3x3 className="h-3.5 w-3.5" />
            </Button>
          </div>
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

      {/* Mobile helper text - only visible on small screens */}
      <div className="md:hidden px-4 py-2 border-b bg-muted/30">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <LucideIcons.Hand className="h-3 w-3" />
          Tap a component to add it to canvas
        </p>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="h-full w-full overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {loading ? (
            <div className="space-y-0">
              <div>
                <div className="py-3">
                  <Skeleton className="h-4 w-24 mb-2" />
                  {viewMode === 'list' ? (
                    <div className="space-y-0.5">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                          <Skeleton className="h-5 w-5 rounded flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <Skeleton className="h-4 w-32 mb-1" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 text-center py-8">
              Failed to load components: {error}
            </div>
          ) : filteredComponents.length === 0 ? (
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

                    const categoryAccentColor = getCategoryAccentColor(category)

                    return (
                      <AccordionItem
                        key={category}
                        value={category}
                        className="border border-border/50 rounded-sm px-3 py-1 transition-colors"
                      >
                        <AccordionTrigger
                          className={cn(
                            'py-3 hover:no-underline hover:bg-muted/50 rounded-sm -mx-3 -my-1 px-3 [&[data-state=open]]:text-foreground',
                            'group transition-colors relative'
                          )}
                          style={{
                            borderLeftWidth: categoryAccentColor ? '3px' : undefined,
                            borderLeftColor: categoryAccentColor || undefined,
                          }}
                        >
                          <div className="flex flex-col items-start gap-0.5 w-full">
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2">
                                {categoryConfig?.icon && (
                                  (() => {
                                    const iconName = categoryConfig.icon in LucideIcons ? categoryConfig.icon : 'Box'
                                    const CategoryIcon = LucideIcons[iconName as keyof typeof LucideIcons] as React.ComponentType<{ className?: string }>
                                    return (
                                      <CategoryIcon className={cn(
                                        'h-4 w-4 flex-shrink-0',
                                        getCategoryTextColor(category)
                                      )} />
                                    )
                                  })()
                                )}
                                <h3 className={cn(
                                  'text-sm font-semibold transition-colors',
                                  getCategoryTextColor(category)
                                )}>
                                  {categoryConfig?.label ?? category}
                                </h3>
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1 pb-2 px-0">
                          {viewMode === 'list' ? (
                            <div className="space-y-0.5">
                              {components.map((component) => (
                                <ComponentItem
                                  key={component.id}
                                  component={component}
                                  disabled={!canManageWorkflows}
                                  viewMode={viewMode}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {components.map((component) => (
                                <ComponentItem
                                  key={component.id}
                                  component={component}
                                  disabled={!canManageWorkflows}
                                  viewMode={viewMode}
                                />
                              ))}
                            </div>
                          )}
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
                    ? `${Object.values(filteredComponentsByCategory).reduce((total, components) => total + components.length, 0)} of ${filteredComponents.length} component${filteredComponents.length !== 1 ? 's' : ''} shown`
                    : `${filteredComponents.length} component${filteredComponents.length !== 1 ? 's' : ''} available`
                  }
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Custom overlay scrollbar */}
        {scrollbarHeight > 0 && (
          <div
            className={cn(
              'absolute right-1 top-2 w-0.5 bg-muted-foreground/50 rounded-full transition-opacity duration-300 pointer-events-none z-10',
              scrollbarVisible ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              height: `${scrollbarHeight}px`,
              transform: `translateY(${scrollbarPosition}px)`,
            }}
          />
        )}
      </div>
    </div>
  )
}
