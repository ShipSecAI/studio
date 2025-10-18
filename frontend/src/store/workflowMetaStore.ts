import { create } from 'zustand'

export interface WorkflowMetadata {
  id: string | null
  name: string
  description: string
}

export interface WorkflowMetaState {
  metadata: WorkflowMetadata
  isDirty: boolean
}

export interface WorkflowMetaActions {
  setWorkflowId(id: string): void
  setWorkflowName(name: string): void
  setWorkflowDescription(description: string): void
  setMetadata(metadata: Partial<WorkflowMetadata>): void
  markDirty(): void
  markClean(): void
  resetWorkflow(): void
}

const initialMetadata: WorkflowMetadata = {
  id: null,
  name: 'Untitled Workflow',
  description: '',
}

type WorkflowMetaStore = WorkflowMetaState & WorkflowMetaActions

export const useWorkflowMetaStore = create<WorkflowMetaStore>()((set) => ({
  metadata: initialMetadata,
  isDirty: false,

  setWorkflowId: (id) => {
    set((state) => ({
      metadata: { ...state.metadata, id },
    }))
  },

  setWorkflowName: (name) => {
    set((state) => ({
      metadata: { ...state.metadata, name },
      isDirty: true,
    }))
  },

  setWorkflowDescription: (description) => {
    set((state) => ({
      metadata: { ...state.metadata, description },
      isDirty: true,
    }))
  },

  setMetadata: (metadata) => {
    set((state) => ({
      metadata: { ...state.metadata, ...metadata },
    }))
  },

  markDirty: () => {
    set({ isDirty: true })
  },

  markClean: () => {
    set({ isDirty: false })
  },

  resetWorkflow: () => {
    set({ metadata: initialMetadata, isDirty: false })
  },
}))
