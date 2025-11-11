import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WorkflowMode = 'design' | 'execution'

interface WorkflowUiState {
  mode: WorkflowMode
  inspectorTab: 'events' | 'logs' | 'artifacts'
  libraryOpen: boolean
  inspectorWidth: number
}

interface WorkflowUiActions {
  setMode: (mode: WorkflowMode) => void
  setInspectorTab: (tab: WorkflowUiState['inspectorTab']) => void
  setLibraryOpen: (open: boolean) => void
  toggleLibrary: () => void
  setInspectorWidth: (width: number) => void
}

export const useWorkflowUiStore = create<WorkflowUiState & WorkflowUiActions>()(
  persist(
    (set) => ({
      mode: 'design',
      inspectorTab: 'events',
      libraryOpen: true,
      inspectorWidth: 360,
      setMode: (mode) => set((state) => ({
        mode,
        inspectorTab: mode === 'execution' ? state.inspectorTab ?? 'events' : 'events',
        libraryOpen: mode === 'design'
      })),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setLibraryOpen: (open) => set({ libraryOpen: open }),
      toggleLibrary: () => set((state) => ({ libraryOpen: !state.libraryOpen })),
      setInspectorWidth: (width) => set(() => ({
        inspectorWidth: Math.max(280, Math.min(520, Math.round(width)))
      })),
    }),
    {
      name: 'workflow-ui-preferences',
      partialize: (state) => ({
        mode: state.mode,
        libraryOpen: state.libraryOpen,
        inspectorWidth: state.inspectorWidth,
      }),
    }
  )
)
