import { create } from 'zustand'

import type { ComponentMetadata } from '@/schemas/component'
import { api } from '@/services/api'

interface ComponentStoreState {
  components: Record<string, ComponentMetadata>
  slugIndex: Record<string, string>
  loading: boolean
  error: string | null
}

interface ComponentStore extends ComponentStoreState {
  fetchComponents: () => Promise<void>
  getComponent: (ref?: string | null) => ComponentMetadata | null
  getComponentsByType: (type: ComponentMetadata['type']) => ComponentMetadata[]
  getComponentsByCategory: (category: ComponentMetadata['category']) => ComponentMetadata[]
  searchComponents: (query: string) => ComponentMetadata[]
  getAllComponents: () => ComponentMetadata[]
}

/**
 * Normalize components by ID and maintain a slug lookup table.
 */
function buildIndexes(components: ComponentMetadata[]) {
  const byId: Record<string, ComponentMetadata> = {}
  const slugIndex: Record<string, string> = {}

  components.forEach((component) => {
    byId[component.id] = component
    if (component.slug) {
      slugIndex[component.slug] = component.id
    }
  })

  return { byId, slugIndex }
}

/**
 * Component Store
 * Consumes backend component metadata and provides convenient selectors.
 */
export const useComponentStore = create<ComponentStore>((set, get) => ({
  components: {},
  slugIndex: {},
  loading: false,
  error: null,

  fetchComponents: async () => {
    set({ loading: true, error: null })
    try {
      const components = await api.components.list()
      const { byId, slugIndex } = buildIndexes(components)
      set({ components: byId, slugIndex, loading: false })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch components',
        loading: false,
      })
    }
  },

  getComponent: (ref?: string | null) => {
    const { components, slugIndex } = get()
    if (!ref) return null

    if (components[ref]) {
      return components[ref]
    }

    const idFromSlug = slugIndex[ref]
    if (idFromSlug && components[idFromSlug]) {
      return components[idFromSlug]
    }

    return null
  },

  getComponentsByType: (type: ComponentMetadata['type']) => {
    return Object.values(get().components).filter((component) => component.type === type)
  },

  getComponentsByCategory: (category: ComponentMetadata['category']) => {
    return Object.values(get().components).filter((component) => component.category === category)
  },

  searchComponents: (query: string) => {
    if (!query) {
      return Object.values(get().components)
    }

    const normalized = query.toLowerCase()
    return Object.values(get().components).filter((component) => {
      return (
        component.name.toLowerCase().includes(normalized) ||
        component.slug.toLowerCase().includes(normalized) ||
        (component.description ?? '').toLowerCase().includes(normalized)
      )
    })
  },

  getAllComponents: () => {
    return Object.values(get().components)
  },
}))
