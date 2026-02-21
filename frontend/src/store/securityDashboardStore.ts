import { create } from 'zustand';
import type { SecurityViewFilter, SecurityFilterKey } from '@/config/securityViews';
import { FILTER_KEY_TO_STORE_KEY } from '@/config/securityViews';
import type { SecurityDashboardFilters, SecurityFinding } from '@/lib/securityQueryHelpers';
import { INITIAL_FILTERS } from '@/lib/securityQueryHelpers';

// Re-export types for any remaining consumers
export type { SecurityFinding, FindingLifecycle } from '@/lib/securityQueryHelpers';

/** All filter keys that can be pruned (excludes pagination/search/sort meta) */
const ALL_FILTER_KEYS: SecurityFilterKey[] = [
  'severity',
  'status',
  'region',
  'service',
  'compliance',
  'check',
  'tags',
  'scanner',
  'repository',
  'rule',
  'file',
  'language',
  'account',
];

interface SecurityDashboardState {
  filters: SecurityDashboardFilters;
  viewFilter: SecurityViewFilter;
  selectedFinding: SecurityFinding | null;
}

interface SecurityDashboardActions {
  setFilters: (filters: Partial<SecurityDashboardFilters>) => void;
  resetFilters: () => void;
  setViewFilter: (viewFilter: SecurityViewFilter, allowedFilters?: SecurityFilterKey[]) => void;
  setSelectedFinding: (finding: SecurityFinding | null) => void;
}

export type SecurityDashboardStore = SecurityDashboardState & SecurityDashboardActions;

export const useSecurityDashboardStore = create<SecurityDashboardStore>((set, get) => ({
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

  setViewFilter: (viewFilter: SecurityViewFilter, allowedFilters?: SecurityFilterKey[]) => {
    const current = get().filters;

    if (!allowedFilters) {
      set({ viewFilter, filters: { ...current, page: 1 } });
      return;
    }

    // Prune filters not in the new tab's allowed list
    const allowedSet = new Set(allowedFilters);
    const pruned: Partial<SecurityDashboardFilters> = { page: 1 };

    for (const filterKey of ALL_FILTER_KEYS) {
      if (!allowedSet.has(filterKey)) {
        const storeKey = FILTER_KEY_TO_STORE_KEY[filterKey] as keyof SecurityDashboardFilters;
        const initial = INITIAL_FILTERS[storeKey];
        if (current[storeKey] !== initial) {
          (pruned as Record<string, unknown>)[storeKey] = initial;
        }
      }
    }

    set({ viewFilter, filters: { ...current, ...pruned } });
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
