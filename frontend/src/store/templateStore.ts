import { create } from 'zustand'

interface Template {
  id: string
  name: string
  description: string | null
  content: Record<string, unknown>
  inputSchema: Record<string, unknown>
  sampleData: Record<string, unknown> | null
  version: number
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

interface TemplateStoreState {
  templates: Template[]
  loading: boolean
  error: string | null
  selectedTemplate: Template | null
  fetchTemplates: (filters?: { isSystem?: boolean }) => Promise<void>
  selectTemplate: (id: string) => Promise<void>
  createTemplate: (data: Partial<Template>) => Promise<Template>
  updateTemplate: (id: string, data: Partial<Template>) => Promise<Template>
  deleteTemplate: (id: string) => Promise<void>
}

export const useTemplateStore = create<TemplateStoreState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  selectedTemplate: null,

  async fetchTemplates(filters) {
    set({ loading: true, error: null })
    try {
      const params = new URLSearchParams()
      if (filters?.isSystem !== undefined) {
        params.set('isSystem', String(filters.isSystem))
      }

      const response = await fetch(`/api/v1/templates?${params}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch templates')
      }

      const templates = await response.json()
      set({ templates, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch templates',
      })
    }
  },

  async selectTemplate(id) {
    const existing = get().templates.find((t) => t.id === id)
    if (existing) {
      set({ selectedTemplate: existing })
      return
    }

    set({ loading: true, error: null })
    try {
      const response = await fetch(`/api/v1/templates/${id}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Template not found')
      }

      const template = await response.json()
      set({ selectedTemplate: template, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch template',
      })
    }
  },

  async createTemplate(data) {
    const response = await fetch('/api/v1/templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error('Failed to create template')
    }

    const template = await response.json()
    set((state) => ({
      templates: [template, ...state.templates],
    }))
    return template
  },

  async updateTemplate(id, data) {
    const response = await fetch(`/api/v1/templates/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error('Failed to update template')
    }

    const template = await response.json()
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? template : t)),
      selectedTemplate: state.selectedTemplate?.id === id ? template : state.selectedTemplate,
    }))
    return template
  },

  async deleteTemplate(id) {
    const response = await fetch(`/api/v1/templates/${id}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error('Failed to delete template')
    }

    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      selectedTemplate: state.selectedTemplate?.id === id ? null : state.selectedTemplate,
    }))
  },
}))
