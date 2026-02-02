import { create } from 'zustand';

interface PlacementState {
  componentId: string | null;
  componentName: string | null;
  isActive: boolean;
  // Scope placement to a specific workflow ID
  workflowId: string | null;
}

interface PlacementActions {
  setPlacement: (componentId: string, componentName: string, workflowId: string | null) => void;
  clearPlacement: () => void;
  // Check if placement is active for a specific workflow
  isPlacementActiveForWorkflow: (workflowId: string | null) => boolean;
}

/**
 * Component Placement Store
 * Manages the state for placing components on the canvas via spotlight/sidebar.
 * Placement is scoped to a specific workflow to avoid cross-workflow interference.
 */
export const usePlacementStore = create<PlacementState & PlacementActions>((set, get) => ({
  componentId: null,
  componentName: null,
  isActive: false,
  workflowId: null,

  setPlacement: (componentId, componentName, workflowId) => {
    set({
      componentId,
      componentName,
      isActive: true,
      workflowId,
    });
  },

  clearPlacement: () => {
    set({
      componentId: null,
      componentName: null,
      isActive: false,
      workflowId: null,
    });
  },

  isPlacementActiveForWorkflow: (workflowId) => {
    const state = get();
    // For new workflows (null ID), match if placement workflowId is also null
    // For existing workflows, match by ID
    return state.isActive && state.workflowId === workflowId;
  },
}));

// Legacy exports for backward compatibility during migration
// TODO: Remove these after all usages are migrated to usePlacementStore
export const mobilePlacementState = {
  get componentId() {
    return usePlacementStore.getState().componentId;
  },
  get componentName() {
    return usePlacementStore.getState().componentName;
  },
  get isActive() {
    return usePlacementStore.getState().isActive;
  },
  onSidebarClose: null as (() => void) | null,
};

export const setMobilePlacementSidebarClose = (callback: () => void) => {
  mobilePlacementState.onSidebarClose = callback;
};

export const clearMobilePlacement = () => {
  usePlacementStore.getState().clearPlacement();
};
