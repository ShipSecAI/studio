import { create } from 'zustand';
import type { SecurityViewFilter, SecurityViewDefinition } from '@/config/securityViews';
import type { SecurityDashboardFilters, SecurityFinding } from '@/lib/securityQueryHelpers';
import { INITIAL_FILTERS } from '@/lib/securityQueryHelpers';

// Re-export types for any remaining consumers
export type { SecurityFinding, FindingLifecycle } from '@/lib/securityQueryHelpers';

interface SecurityDashboardState {
  filters: SecurityDashboardFilters;
  viewFilter: SecurityViewFilter;
  selectedFinding: SecurityFinding | null;
}

interface SecurityDashboardActions {
  setFilters: (filters: Partial<SecurityDashboardFilters>) => void;
  resetFilters: () => void;
  setViewFilter: (viewFilter: SecurityViewFilter, viewDef?: SecurityViewDefinition) => void;
  setSelectedFinding: (finding: SecurityFinding | null) => void;
}

export type SecurityDashboardStore = SecurityDashboardState & SecurityDashboardActions;

export const useSecurityDashboardStore = create<SecurityDashboardStore>((set) => ({
  filters: { ...INITIAL_FILTERS },
  viewFilter: {},
  selectedFinding: null,

  setFilters: (partial) => {
    set((state) => ({
      filters: { ...state.filters, ...partial },
    }));
  },

  resetFilters: () => {
    set({ filters: { ...INITIAL_FILTERS } });
  },

  setViewFilter: (viewFilter: SecurityViewFilter, viewDef?: SecurityViewDefinition) => {
    const statusDefault = viewDef?.defaultFilters?.status ?? [];
    set({
      viewFilter,
      filters: { ...INITIAL_FILTERS, status: statusDefault, page: 1 },
    });
  },

  setSelectedFinding: (finding) => {
    set({ selectedFinding: finding });
  },
}));

export const resetSecurityDashboardState = () => {
  useSecurityDashboardStore.setState({
    filters: { ...INITIAL_FILTERS },
    viewFilter: {},
    selectedFinding: null,
  });
};
