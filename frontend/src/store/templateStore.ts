import { create } from 'zustand'
import type { components } from '@shipsec/backend-client'
import { api } from '@/services/api'

type Template = components['schemas']['TemplateResponseDto']
type CreateReportTemplateDto = components['schemas']['CreateReportTemplateDto']
type UpdateReportTemplateDto = components['schemas']['UpdateReportTemplateDto']

interface TemplateStoreState {
  templates: Template[]
  loading: boolean
  error: string | null
  selectedTemplate: Template | null
  fetchTemplates: (filters?: { isSystem?: boolean }) => Promise<void>
  selectTemplate: (id: string) => Promise<void>
  createTemplate: (data: CreateReportTemplateDto) => Promise<Template>
  updateTemplate: (id: string, data: UpdateReportTemplateDto) => Promise<Template>
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
      const templates = await api.templates.list(filters)
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
      const template = await api.templates.get(id)
      set({ selectedTemplate: template, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch template',
      })
    }
  },

  async createTemplate(data) {
    const template = await api.templates.create(data)
    set((state) => ({
      templates: [template, ...state.templates],
    }))
    return template
  },

  async updateTemplate(id, data) {
    const template = await api.templates.update(id, data)
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? template : t)),
      selectedTemplate: state.selectedTemplate?.id === id ? template : state.selectedTemplate,
    }))
    return template
  },

  async deleteTemplate(id) {
    await api.templates.delete(id)
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      selectedTemplate: state.selectedTemplate?.id === id ? null : state.selectedTemplate,
    }))
  },
}))
