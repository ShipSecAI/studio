import { beforeEach, describe, expect, it } from 'bun:test';
import { useChatStore } from '../chatStore';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      const { [key]: _, ...rest } = store;
      store = rest;
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('chatStore', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorageMock.clear();

    // Reset store to initial state
    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      isCommandPaletteOpen: false,
      isWorkflowPreviewOpen: false,
      selectedWorkflowId: null,
      isSidebarOpen: true,
    });
  });

  describe('Initial State', () => {
    it('initializes with empty sessions and null currentSessionId', () => {
      const state = useChatStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.currentSessionId).toBeNull();
    });

    it('initializes with UI states set to defaults', () => {
      const state = useChatStore.getState();
      expect(state.isCommandPaletteOpen).toBe(false);
      expect(state.isWorkflowPreviewOpen).toBe(false);
      expect(state.selectedWorkflowId).toBeNull();
      expect(state.isSidebarOpen).toBe(true);
    });
  });

  describe('Session Management', () => {
    describe('createSession', () => {
      it('creates a new session with correct properties', () => {
        const sessionId = useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(1);
        expect(state.sessions[0].id).toBe(sessionId);
        expect(state.sessions[0].title).toBe('New Conversation');
        expect(state.sessions[0].isActive).toBe(true);
        expect(state.sessions[0].createdAt).toBeInstanceOf(Date);
        expect(state.sessions[0].updatedAt).toBeInstanceOf(Date);
      });

      it('sets new session as current session', () => {
        const sessionId = useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(sessionId);
      });

      it('marks existing sessions as inactive when creating new session', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(2);
        const firstSession = state.sessions.find((s) => s.id === firstSessionId);
        const secondSession = state.sessions.find((s) => s.id === secondSessionId);

        expect(firstSession?.isActive).toBe(false);
        expect(secondSession?.isActive).toBe(true);
      });

      it('adds new session to the beginning of the array', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.sessions[0].id).toBe(secondSessionId);
        expect(state.sessions[1].id).toBe(firstSessionId);
      });
    });

    describe('deleteSession', () => {
      it('removes the specified session', () => {
        const sessionId = useChatStore.getState().createSession();
        useChatStore.getState().deleteSession(sessionId);
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(0);
      });

      it('sets currentSessionId to first remaining session when deleting current session', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();

        // Second session is current
        expect(useChatStore.getState().currentSessionId).toBe(secondSessionId);

        useChatStore.getState().deleteSession(secondSessionId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(firstSessionId);
        expect(state.sessions).toHaveLength(1);
      });

      it('sets currentSessionId to null when deleting the last session', () => {
        const sessionId = useChatStore.getState().createSession();
        useChatStore.getState().deleteSession(sessionId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBeNull();
        expect(state.sessions).toHaveLength(0);
      });

      it('keeps currentSessionId unchanged when deleting non-current session', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();

        // Second session is current
        expect(useChatStore.getState().currentSessionId).toBe(secondSessionId);

        useChatStore.getState().deleteSession(firstSessionId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(secondSessionId);
        expect(state.sessions).toHaveLength(1);
      });

      it('handles deleting non-existent session gracefully', () => {
        const sessionId = useChatStore.getState().createSession();
        useChatStore.getState().deleteSession('non-existent-id');
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(1);
        expect(state.currentSessionId).toBe(sessionId);
      });
    });

    describe('setCurrentSession', () => {
      it('updates currentSessionId', () => {
        const firstSessionId = useChatStore.getState().createSession();
        useChatStore.getState().createSession();

        useChatStore.getState().setCurrentSession(firstSessionId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(firstSessionId);
      });

      it('marks only the selected session as active', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();

        useChatStore.getState().setCurrentSession(firstSessionId);
        const state = useChatStore.getState();

        const firstSession = state.sessions.find((s) => s.id === firstSessionId);
        const secondSession = state.sessions.find((s) => s.id === secondSessionId);

        expect(firstSession?.isActive).toBe(true);
        expect(secondSession?.isActive).toBe(false);
      });
    });

    describe('updateSessionTitle', () => {
      it('updates the title of the specified session', () => {
        const sessionId = useChatStore.getState().createSession();
        const newTitle = 'Updated Title';

        useChatStore.getState().updateSessionTitle(sessionId, newTitle);
        const state = useChatStore.getState();

        expect(state.sessions[0].title).toBe(newTitle);
      });

      it('updates the updatedAt timestamp', () => {
        const sessionId = useChatStore.getState().createSession();
        const originalUpdatedAt = useChatStore.getState().sessions[0].updatedAt;

        // Wait a bit to ensure timestamp difference
        const beforeUpdate = new Date();
        useChatStore.getState().updateSessionTitle(sessionId, 'New Title');
        const state = useChatStore.getState();

        expect(state.sessions[0].updatedAt.getTime()).toBeGreaterThanOrEqual(
          beforeUpdate.getTime(),
        );
        expect(state.sessions[0].updatedAt).not.toBe(originalUpdatedAt);
      });

      it('does not modify other sessions', () => {
        const firstSessionId = useChatStore.getState().createSession();
        const secondSessionId = useChatStore.getState().createSession();

        useChatStore.getState().updateSessionTitle(firstSessionId, 'Updated Title');
        const state = useChatStore.getState();

        const secondSession = state.sessions.find((s) => s.id === secondSessionId);
        expect(secondSession?.title).toBe('New Conversation');
      });
    });

    describe('getCurrentSession', () => {
      it('returns the current session', () => {
        const sessionId = useChatStore.getState().createSession();
        const currentSession = useChatStore.getState().getCurrentSession();

        expect(currentSession).not.toBeNull();
        expect(currentSession?.id).toBe(sessionId);
      });

      it('returns null when no current session', () => {
        const currentSession = useChatStore.getState().getCurrentSession();
        expect(currentSession).toBeNull();
      });

      it('returns null when currentSessionId does not match any session', () => {
        useChatStore.getState().createSession();
        useChatStore.setState({ currentSessionId: 'non-existent-id' });

        const currentSession = useChatStore.getState().getCurrentSession();
        expect(currentSession).toBeNull();
      });
    });
  });

  describe('UI State Management', () => {
    describe('Command Palette', () => {
      it('toggles command palette state', () => {
        expect(useChatStore.getState().isCommandPaletteOpen).toBe(false);

        useChatStore.getState().toggleCommandPalette();
        expect(useChatStore.getState().isCommandPaletteOpen).toBe(true);

        useChatStore.getState().toggleCommandPalette();
        expect(useChatStore.getState().isCommandPaletteOpen).toBe(false);
      });

      it('sets command palette open state explicitly', () => {
        useChatStore.getState().setCommandPaletteOpen(true);
        expect(useChatStore.getState().isCommandPaletteOpen).toBe(true);

        useChatStore.getState().setCommandPaletteOpen(false);
        expect(useChatStore.getState().isCommandPaletteOpen).toBe(false);
      });
    });

    describe('Workflow Preview', () => {
      it('toggles workflow preview state', () => {
        expect(useChatStore.getState().isWorkflowPreviewOpen).toBe(false);

        useChatStore.getState().toggleWorkflowPreview();
        expect(useChatStore.getState().isWorkflowPreviewOpen).toBe(true);

        useChatStore.getState().toggleWorkflowPreview();
        expect(useChatStore.getState().isWorkflowPreviewOpen).toBe(false);
      });

      it('sets workflow preview open state explicitly', () => {
        useChatStore.getState().setWorkflowPreviewOpen(true);
        expect(useChatStore.getState().isWorkflowPreviewOpen).toBe(true);

        useChatStore.getState().setWorkflowPreviewOpen(false);
        expect(useChatStore.getState().isWorkflowPreviewOpen).toBe(false);
      });
    });

    describe('Selected Workflow', () => {
      it('sets selected workflow and opens preview when workflow is selected', () => {
        useChatStore.getState().setSelectedWorkflow('workflow-123');
        const state = useChatStore.getState();

        expect(state.selectedWorkflowId).toBe('workflow-123');
        expect(state.isWorkflowPreviewOpen).toBe(true);
      });

      it('clears selected workflow and closes preview when set to null', () => {
        // First set a workflow
        useChatStore.getState().setSelectedWorkflow('workflow-123');
        expect(useChatStore.getState().selectedWorkflowId).toBe('workflow-123');

        // Then clear it
        useChatStore.getState().setSelectedWorkflow(null);
        const state = useChatStore.getState();

        expect(state.selectedWorkflowId).toBeNull();
        expect(state.isWorkflowPreviewOpen).toBe(false);
      });
    });

    describe('Sidebar', () => {
      it('toggles sidebar state', () => {
        expect(useChatStore.getState().isSidebarOpen).toBe(true);

        useChatStore.getState().toggleSidebar();
        expect(useChatStore.getState().isSidebarOpen).toBe(false);

        useChatStore.getState().toggleSidebar();
        expect(useChatStore.getState().isSidebarOpen).toBe(true);
      });

      it('sets sidebar open state explicitly', () => {
        useChatStore.getState().setSidebarOpen(false);
        expect(useChatStore.getState().isSidebarOpen).toBe(false);

        useChatStore.getState().setSidebarOpen(true);
        expect(useChatStore.getState().isSidebarOpen).toBe(true);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles multiple rapid session creations', () => {
      const sessionIds = [
        useChatStore.getState().createSession(),
        useChatStore.getState().createSession(),
        useChatStore.getState().createSession(),
      ];
      const state = useChatStore.getState();

      expect(state.sessions).toHaveLength(3);
      expect(state.currentSessionId).toBe(sessionIds[2]);

      // Only the last session should be active
      const activeSessions = state.sessions.filter((s) => s.isActive);
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(sessionIds[2]);
    });

    it('handles deleting all sessions one by one', () => {
      const sessionIds = [
        useChatStore.getState().createSession(),
        useChatStore.getState().createSession(),
        useChatStore.getState().createSession(),
      ];

      useChatStore.getState().deleteSession(sessionIds[2]);
      expect(useChatStore.getState().currentSessionId).toBe(sessionIds[1]);

      useChatStore.getState().deleteSession(sessionIds[1]);
      expect(useChatStore.getState().currentSessionId).toBe(sessionIds[0]);

      useChatStore.getState().deleteSession(sessionIds[0]);
      expect(useChatStore.getState().currentSessionId).toBeNull();
      expect(useChatStore.getState().sessions).toHaveLength(0);
    });

    it('maintains state consistency when switching between sessions', () => {
      const firstSessionId = useChatStore.getState().createSession();
      const secondSessionId = useChatStore.getState().createSession();
      const thirdSessionId = useChatStore.getState().createSession();

      useChatStore.getState().setCurrentSession(firstSessionId);
      expect(useChatStore.getState().currentSessionId).toBe(firstSessionId);

      useChatStore.getState().setCurrentSession(thirdSessionId);
      expect(useChatStore.getState().currentSessionId).toBe(thirdSessionId);

      useChatStore.getState().setCurrentSession(secondSessionId);
      const state = useChatStore.getState();

      expect(state.currentSessionId).toBe(secondSessionId);

      // Verify only one session is active
      const activeSessions = state.sessions.filter((s) => s.isActive);
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(secondSessionId);
    });
  });

  describe('Persistence (partialize)', () => {
    // Zustand persist writes to localStorage asynchronously, so instead of reading
    // from localStorage we test the partialize config by checking what the persist
    // API exposes — the `getOptions().partialize` function.

    it('partializes only sessions, currentSessionId, and isSidebarOpen', () => {
      const sessionId = useChatStore.getState().createSession();
      useChatStore.getState().setCommandPaletteOpen(true);
      useChatStore.getState().setWorkflowPreviewOpen(true);
      useChatStore.getState().setSelectedWorkflow('workflow-123');
      useChatStore.getState().setSidebarOpen(false);

      const partialize = useChatStore.persist.getOptions().partialize!;
      const persisted = partialize(useChatStore.getState()) as Record<string, any>;

      // Check persisted fields exist
      expect(persisted.sessions).toBeDefined();
      expect(persisted.sessions).toHaveLength(1);
      expect(persisted.currentSessionId).toBe(sessionId);
      expect(persisted.isSidebarOpen).toBe(false);

      // Check non-persisted fields are NOT included
      expect('isCommandPaletteOpen' in persisted).toBe(false);
      expect('isWorkflowPreviewOpen' in persisted).toBe(false);
      expect('selectedWorkflowId' in persisted).toBe(false);
    });

    it('does not include UI state in partialized output', () => {
      useChatStore.getState().createSession();
      useChatStore.getState().setCommandPaletteOpen(true);
      useChatStore.getState().setWorkflowPreviewOpen(true);
      useChatStore.getState().setSelectedWorkflow('workflow-456');

      const partialize = useChatStore.persist.getOptions().partialize!;
      const persisted = partialize(useChatStore.getState()) as Record<string, any>;

      expect('isCommandPaletteOpen' in persisted).toBe(false);
      expect('isWorkflowPreviewOpen' in persisted).toBe(false);
      expect('selectedWorkflowId' in persisted).toBe(false);
    });

    it('includes sidebar state in partialized output', () => {
      useChatStore.getState().setSidebarOpen(false);

      const partialize = useChatStore.persist.getOptions().partialize!;
      let persisted = partialize(useChatStore.getState()) as Record<string, any>;
      expect(persisted.isSidebarOpen).toBe(false);

      useChatStore.getState().setSidebarOpen(true);
      persisted = partialize(useChatStore.getState()) as Record<string, any>;
      expect(persisted.isSidebarOpen).toBe(true);
    });

    it('includes updated session titles in partialized output', () => {
      const sessionId = useChatStore.getState().createSession();
      useChatStore.getState().updateSessionTitle(sessionId, 'Persisted Title');

      const partialize = useChatStore.persist.getOptions().partialize!;
      const persisted = partialize(useChatStore.getState()) as Record<string, any>;

      expect(persisted.sessions[0].title).toBe('Persisted Title');
    });

    it('reflects session deletions in partialized output', () => {
      const firstId = useChatStore.getState().createSession();
      const secondId = useChatStore.getState().createSession();

      useChatStore.getState().deleteSession(secondId);

      const partialize = useChatStore.persist.getOptions().partialize!;
      const persisted = partialize(useChatStore.getState()) as Record<string, any>;

      expect(persisted.sessions).toHaveLength(1);
      expect(persisted.sessions[0].id).toBe(firstId);
      expect(persisted.currentSessionId).toBe(firstId);
    });
  });
});
