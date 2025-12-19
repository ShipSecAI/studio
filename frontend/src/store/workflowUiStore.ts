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
  showDemoComponents: boolean
}

interface WorkflowUiActions {
  setMode: (mode: WorkflowMode) => void
  setInspectorTab: (tab: WorkflowUiState['inspectorTab']) => void
  setLibraryOpen: (open: boolean) => void
  toggleLibrary: () => void
  setInspectorWidth: (width: number) => void
  /** Bring a terminal panel to the front by setting it as focused */
  bringTerminalToFront: (nodeId: string) => void
  toggleDemoComponents: () => void
}

export const useWorkflowUiStore = create<WorkflowUiState & WorkflowUiActions>()(
  persist(
    (set) => ({
      mode: 'design',
      inspectorTab: 'events',
      libraryOpen: true,
      inspectorWidth: 360,
      focusedTerminalNodeId: null,
      setMode: (mode) => set((state) => ({
        mode,
        inspectorTab: mode === 'execution' ? state.inspectorTab ?? 'events' : 'events',
        libraryOpen: mode === 'design'
      })),
      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setLibraryOpen: (open) => set({ libraryOpen: open }),
      toggleLibrary: () => set((state) => ({ libraryOpen: !state.libraryOpen })),
      setInspectorWidth: (width) => set(() => ({
        inspectorWidth: Math.max(320, Math.min(520, Math.round(width)))
      })),
      bringTerminalToFront: (nodeId) => set({ focusedTerminalNodeId: nodeId }),
      showDemoComponents: false,
      toggleDemoComponents: () => set((state) => ({ showDemoComponents: !state.showDemoComponents })),
    }),
    {
      name: 'workflow-ui-preferences',
      partialize: (state) => ({
        // Note: 'mode' is intentionally NOT persisted - workflows should always open in design mode
        libraryOpen: state.libraryOpen,
        inspectorWidth: state.inspectorWidth,
      }),
      // Merge function to ensure mode is never restored from localStorage
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<WorkflowUiState>),
        // Always use default mode, never restore from localStorage
        mode: 'design' as WorkflowMode,
      }),
    }
  )
)
