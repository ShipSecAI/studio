import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WorkflowMode = 'design' | 'execution'

interface WorkflowUiState {
  mode: WorkflowMode
  inspectorTab: 'events' | 'logs' | 'artifacts' | 'agent'
  libraryOpen: boolean
  inspectorWidth: number
  /** Currently focused terminal panel's node ID (for z-index stacking) */
  focusedTerminalNodeId: string | null
}

interface WorkflowUiActions {
  setMode: (mode: WorkflowMode) => void
  setInspectorTab: (tab: WorkflowUiState['inspectorTab']) => void
  setLibraryOpen: (open: boolean) => void
  toggleLibrary: () => void
  setInspectorWidth: (width: number) => void
  /** Bring a terminal panel to the front by setting it as focused */
  bringTerminalToFront: (nodeId: string) => void
}

export const useWorkflowUiStore = create<WorkflowUiState & WorkflowUiActions>()(
  persist(
    (set) => ({
      mode: 'design',
      inspectorTab: 'events',
      libraryOpen: true,
      inspectorWidth: 360,
      setMode: (mode) => {
        // When switching to execution mode, reset the execution timeline store
        // to show an empty canvas (no pre-selected run from previous sessions)
        if (mode === 'execution') {
          void import('./executionTimelineStore').then(({ useExecutionTimelineStore }) => {
            useExecutionTimelineStore.getState().reset()
          })
        }
        set((state) => ({
          mode,
          inspectorTab: mode === 'execution' ? state.inspectorTab ?? 'events' : 'events',
          libraryOpen: mode === 'design'
        }))
      },
      focusedTerminalNodeId: null,
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setLibraryOpen: (open) => set({ libraryOpen: open }),
      toggleLibrary: () => set((state) => ({ libraryOpen: !state.libraryOpen })),
      setInspectorWidth: (width) => set(() => ({
        inspectorWidth: Math.max(280, Math.min(520, Math.round(width)))
      })),
      bringTerminalToFront: (nodeId) => set({ focusedTerminalNodeId: nodeId }),
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
