import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILT_IN_VIEWS, getBuiltInView } from '@/config/securityViews';

const DEFAULT_OPEN_VIEW_IDS = BUILT_IN_VIEWS.filter((v) => !v.disabled).map((v) => v.id);
const DEFAULT_ACTIVE_VIEW_ID = 'home';
const PINNED_VIEW_IDS = ['home', 'all-findings'];

interface SecurityViewState {
  activeViewId: string;
  openViewIds: string[];
  closedBuiltInIds: string[];
}

interface SecurityViewActions {
  setActiveView: (viewId: string) => void;
  closeView: (viewId: string) => void;
  reopenBuiltInView: (viewId: string) => void;
  resetViews: () => void;
}

export const useSecurityViewStore = create<SecurityViewState & SecurityViewActions>()(
  persist(
    (set, get) => ({
      activeViewId: DEFAULT_ACTIVE_VIEW_ID,
      openViewIds: [...DEFAULT_OPEN_VIEW_IDS],
      closedBuiltInIds: [],

      setActiveView: (viewId: string) => {
        const { openViewIds } = get();
        if (openViewIds.includes(viewId)) {
          set({ activeViewId: viewId });
        }
      },

      closeView: (viewId: string) => {
        if (PINNED_VIEW_IDS.includes(viewId)) return; // Pinned tabs are never closeable
        const { openViewIds, activeViewId } = get();
        const newOpen = openViewIds.filter((id) => id !== viewId);
        if (newOpen.length === 0) return; // Don't close the last tab

        const view = getBuiltInView(viewId);
        const newClosed = view?.builtIn
          ? [...get().closedBuiltInIds, viewId]
          : get().closedBuiltInIds;

        let newActive = activeViewId;
        if (activeViewId === viewId) {
          // Switch to adjacent tab
          const closedIdx = openViewIds.indexOf(viewId);
          newActive = newOpen[Math.min(closedIdx, newOpen.length - 1)];
        }

        set({
          openViewIds: newOpen,
          closedBuiltInIds: newClosed,
          activeViewId: newActive,
        });
      },

      resetViews: () => {
        set({
          activeViewId: DEFAULT_ACTIVE_VIEW_ID,
          openViewIds: [...DEFAULT_OPEN_VIEW_IDS],
          closedBuiltInIds: [],
        });
      },

      reopenBuiltInView: (viewId: string) => {
        const view = getBuiltInView(viewId);
        if (!view) return;

        const { openViewIds, closedBuiltInIds } = get();
        if (openViewIds.includes(viewId)) return;

        // Insert at original order position
        const newOpen = [...openViewIds, viewId].sort((a, b) => {
          const aView = getBuiltInView(a);
          const bView = getBuiltInView(b);
          return (aView?.order ?? 999) - (bView?.order ?? 999);
        });

        set({
          openViewIds: newOpen,
          closedBuiltInIds: closedBuiltInIds.filter((id) => id !== viewId),
          activeViewId: viewId,
        });
      },
    }),
    {
      name: 'shipsec-security-views',
      partialize: (state) => ({
        activeViewId: state.activeViewId,
        openViewIds: state.openViewIds,
        closedBuiltInIds: state.closedBuiltInIds,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Self-heal: ensure pinned views are always present
        for (const pinnedId of PINNED_VIEW_IDS) {
          if (!state.openViewIds.includes(pinnedId)) {
            state.openViewIds = [pinnedId, ...state.openViewIds];
            state.closedBuiltInIds = state.closedBuiltInIds.filter((id) => id !== pinnedId);
          }
        }
        // Self-heal: add newly added built-in views that aren't in open or closed lists
        for (const view of BUILT_IN_VIEWS) {
          if (view.disabled) continue;
          if (!state.openViewIds.includes(view.id) && !state.closedBuiltInIds.includes(view.id)) {
            state.openViewIds = [...state.openViewIds, view.id];
          }
        }
        // Sort by view order
        state.openViewIds = state.openViewIds.sort((a, b) => {
          const aView = getBuiltInView(a);
          const bView = getBuiltInView(b);
          return (aView?.order ?? 999) - (bView?.order ?? 999);
        });
      },
    },
  ),
);
