// Global state for mobile component placement (shared between Sidebar and Canvas)
export const mobilePlacementState = {
  componentId: null as string | null,
  componentName: null as string | null,
  isActive: false, // True when a component is selected and waiting to be placed
  onSidebarClose: null as (() => void) | null, // Callback to close sidebar
};

// Function to set the sidebar close callback
export const setMobilePlacementSidebarClose = (callback: () => void) => {
  mobilePlacementState.onSidebarClose = callback;
};

// Function to clear the placement state
export const clearMobilePlacement = () => {
  mobilePlacementState.componentId = null;
  mobilePlacementState.componentName = null;
  mobilePlacementState.isActive = false;
};
