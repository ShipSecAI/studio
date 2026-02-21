import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILT_IN_VIEWS, getBuiltInView, isValidViewId } from '@/config/securityViews';
import type { SecurityViewId } from '@/config/securityViews';

const DEFAULT_OPEN_VIEW_IDS: SecurityViewId[] = BUILT_IN_VIEWS.filter((v) => !v.disabled).map(
  (v) => v.id,
);
const DEFAULT_ACTIVE_VIEW_ID: SecurityViewId = 'home';
const PINNED_VIEW_IDS: SecurityViewId[] = ['home', 'all-findings'];

interface SecurityViewState {
  activeViewId: SecurityViewId;
  openViewIds: SecurityViewId[];
  closedBuiltInIds: SecurityViewId[];
}

interface SecurityViewActions {
  setActiveView: (viewId: SecurityViewId) => void;
  closeView: (viewId: SecurityViewId) => void;
  reopenBuiltInView: (viewId: SecurityViewId) => void;
  resetViews: () => void;
}

export const useSecurityViewStore = create<SecurityViewState & SecurityViewActions>()(
  persist(
    (set, get) => ({
      activeViewId: DEFAULT_ACTIVE_VIEW_ID,
      openViewIds: [...DEFAULT_OPEN_VIEW_IDS],
      closedBuiltInIds: [],

      setActiveView: (viewId: SecurityViewId) => {
        const { openViewIds } = get();
        if (openViewIds.includes(viewId)) {
          set({ activeViewId: viewId });
        }
      },

      closeView: (viewId: SecurityViewId) => {
        if ((PINNED_VIEW_IDS as string[]).includes(viewId)) return;
        const { openViewIds, activeViewId } = get();
        const newOpen = openViewIds.filter((id) => id !== viewId);
        if (newOpen.length === 0) return;

        const view = getBuiltInView(viewId);
        const newClosed = view?.builtIn
          ? [...get().closedBuiltInIds, viewId]
          : get().closedBuiltInIds;

        let newActive = activeViewId;
        if (activeViewId === viewId) {
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

      reopenBuiltInView: (viewId: SecurityViewId) => {
        const view = getBuiltInView(viewId);
        if (!view) return;

        const { openViewIds, closedBuiltInIds } = get();
        if (openViewIds.includes(viewId)) return;

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

        // Sanitize openViewIds: drop unknown/disabled IDs
        state.openViewIds = (state.openViewIds as string[]).filter((id): id is SecurityViewId => {
          if (!isValidViewId(id)) return false;
          const view = getBuiltInView(id);
          return !view?.disabled;
        });

        // Sanitize closedBuiltInIds: drop unknown IDs
        state.closedBuiltInIds = (state.closedBuiltInIds as string[]).filter(
          (id): id is SecurityViewId => isValidViewId(id),
        );

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

        // Validate activeViewId
        if (
          !isValidViewId(state.activeViewId) ||
          getBuiltInView(state.activeViewId)?.disabled ||
          !state.openViewIds.includes(state.activeViewId)
        ) {
          state.activeViewId = 'home';
        }
      },
    },
  ),
);
