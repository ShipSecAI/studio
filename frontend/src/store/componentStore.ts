import { create } from 'zustand';
import { ComponentMetadata } from '@/schemas/component';
import { api } from '@/services/api';

interface ComponentStoreState {
  components: Record<string, ComponentMetadata>;
  slugIndex: Record<string, string>;
  loading: boolean;
  error: string | null;
}

interface ComponentStore extends ComponentStoreState {
  fetchComponents: () => Promise<void>;
  getComponent: (ref?: string | null) => ComponentMetadata | null;
  getComponentsByType: (type: ComponentMetadata['type']) => ComponentMetadata[];
  getComponentsByCategory: (category: ComponentMetadata['category']) => ComponentMetadata[];
  searchComponents: (query: string) => ComponentMetadata[];
  getAllComponents: () => ComponentMetadata[];
}

/**
 * Normalize components by ID and maintain a slug lookup table.
 * Backend returns optional fields, so we filter out invalid components
 */
function buildIndexes(components: any[]) {
  const byId: Record<string, ComponentMetadata> = {};
  const slugIndex: Record<string, string> = {};

  components.forEach((component) => {
    // Filter out components missing required fields
    if (!component?.id || !component?.slug || !component?.name) {
      return;
    }

    // Convert backend format to ComponentMetadata format
    // Backend has optional fields, ComponentMetadata has required fields
    const metadata: ComponentMetadata = {
      id: component.id,
      slug: component.slug,
      name: component.name,
      version: component.version || '1.0.0',
      type: component.type || 'process',
      category: component.category || 'transform',
      categoryConfig: component.categoryConfig || {
        label: component.category || 'Other',
        color: '#666',
        description: '',
        emoji: '📦',
        icon: 'Box',
      },
      description: component.description || '',
      documentation: component.documentation || null,
      documentationUrl: component.documentationUrl || null,
      icon: component.icon || null,
      logo: component.logo || null,
      author: component.author || null,
      isLatest: component.isLatest ?? true,
      deprecated: component.deprecated ?? false,
      example: component.example || null,
      runner: component.runner || { kind: 'inline' },
      inputs: component.inputs || [],
      outputs: component.outputs || [],
      parameters: component.parameters || [],
      examples: component.examples || [],
      toolProvider: component.toolProvider || null,
      toolSchema: component.toolSchema ?? null,
    };

    byId[metadata.id] = metadata;
    slugIndex[metadata.slug] = metadata.id;
  });

  return { byId, slugIndex };
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
    set({ loading: true, error: null });
    try {
      const components = await api.components.list();
      const { byId, slugIndex } = buildIndexes(components);
      set({ components: byId, slugIndex, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch components',
        loading: false,
      });
    }
  },

  getComponent: (ref?: string | null) => {
    const { components, slugIndex } = get();
    if (!ref) return null;

    if (components[ref]) {
      return components[ref];
    }

    const idFromSlug = slugIndex[ref];
    if (idFromSlug && components[idFromSlug]) {
      return components[idFromSlug];
    }

    return null;
  },

  getComponentsByType: (type: ComponentMetadata['type']) => {
    return Object.values(get().components).filter((component) => component.type === type);
  },

  getComponentsByCategory: (category: ComponentMetadata['category']) => {
    return Object.values(get().components).filter((component) => component.category === category);
  },

  searchComponents: (query: string) => {
    if (!query) {
      return Object.values(get().components);
    }

    const normalized = query.toLowerCase();
    return Object.values(get().components).filter((component) => {
      return (
        component.name.toLowerCase().includes(normalized) ||
        component.slug.toLowerCase().includes(normalized) ||
        (component.description ?? '').toLowerCase().includes(normalized)
      );
    });
  },

  getAllComponents: () => {
    return Object.values(get().components);
  },
}));
