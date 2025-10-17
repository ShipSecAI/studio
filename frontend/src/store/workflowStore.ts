import { create } from 'zustand'

interface WorkflowMetadata {
  id: string | null
  name: string
  description: string
}

interface WorkflowStore {
  // State
  metadata: WorkflowMetadata
  isDirty: boolean // Track if workflow has unsaved changes

  // Actions
  setWorkflowId: (id: string) => void
  setWorkflowName: (name: string) => void
  setWorkflowDescription: (description: string) => void
  setMetadata: (metadata: Partial<WorkflowMetadata>) => void
  markDirty: () => void
  markClean: () => void
  resetWorkflow: () => void
}

const initialMetadata: WorkflowMetadata = {
  id: null,
  name: 'Untitled Workflow',
  description: '',
}

/**
 * Workflow Store
 * Manages workflow metadata (name, description, id) and dirty state
 */
export const useWorkflowStore = create<WorkflowStore>((set) => ({
  metadata: initialMetadata,
  isDirty: false,

  /**
   * Set workflow ID (after creating or loading)
   */
  setWorkflowId: (id: string) => {
    set((state) => ({
      metadata: { ...state.metadata, id },
    }))
  },

  /**
   * Set workflow name
   */
  setWorkflowName: (name: string) => {
    set((state) => ({
      metadata: { ...state.metadata, name },
      isDirty: true,
    }))
  },

  /**
   * Set workflow description
   */
  setWorkflowDescription: (description: string) => {
    set((state) => ({
      metadata: { ...state.metadata, description },
      isDirty: true,
    }))
  },

  /**
   * Set multiple metadata fields at once
   */
  setMetadata: (metadata: Partial<WorkflowMetadata>) => {
    set((state) => ({
      metadata: { ...state.metadata, ...metadata },
    }))
  },

  /**
   * Mark workflow as having unsaved changes
   */
  markDirty: () => {
    set({ isDirty: true })
  },

  /**
   * Mark workflow as saved (no unsaved changes)
   */
  markClean: () => {
    set({ isDirty: false })
  },

  /**
   * Reset to initial state (for new workflow)
   */
  resetWorkflow: () => {
    set({ metadata: initialMetadata, isDirty: false })
  },
}))
