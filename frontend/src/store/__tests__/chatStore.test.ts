import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test';
import { useChatStore } from '../chatStore';
import { useAuthStore } from '../authStore';

// Save original fetch to restore after tests
const originalFetch = globalThis.fetch;

// Mock fetch globally for server-backed session operations
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve('{}'),
    json: () => Promise.resolve({}),
  } as Response),
);

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

let sessionCounter = 0;

function mockCreateSessionResponse(title = 'New Conversation') {
  const id = `session-${++sessionCounter}`;
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id,
            title,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        ),
    } as Response),
  );
  return id;
}

function mockDeleteResponse() {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ success: true })),
    } as Response),
  );
}

function mockUpdateTitleResponse(id: string, title: string) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id,
            title,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        ),
    } as Response),
  );
}

function mockListSessionsResponse(sessions: any[] = []) {
  mockFetch.mockImplementationOnce(() =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(sessions)),
    } as Response),
  );
}

describe('chatStore', () => {
  beforeEach(() => {
    // Set up mock fetch for this file's tests
    globalThis.fetch = mockFetch as any;

    localStorageMock.clear();
    sessionCounter = 0;
    mockFetch.mockClear();

    // Initialize authStore with test values
    useAuthStore.setState({
      token: 'test-token',
      userId: 'test-user',
      organizationId: 'local-dev',
      roles: ['user'],
      provider: 'local',
      adminUsername: null,
      adminPassword: null,
    });

    useChatStore.setState({
      sessions: [],
      currentSessionId: null,
      isLoadingSessions: false,
      isCommandPaletteOpen: false,
      isWorkflowPreviewOpen: false,
      selectedWorkflowId: null,
      isSidebarOpen: true,
    });
  });

  afterEach(() => {
    // Restore original fetch to prevent contaminating other test files
    globalThis.fetch = originalFetch;
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
      it('creates a new session via API and stores it', async () => {
        const expectedId = mockCreateSessionResponse();
        const sessionId = await useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(1);
        expect(sessionId).toBe(expectedId);
        expect(state.sessions[0].title).toBe('New Conversation');
      });

      it('sets new session as current session', async () => {
        const expectedId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(expectedId);
      });

      it('adds new session to the beginning of the array', async () => {
        const firstId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        const secondId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        const state = useChatStore.getState();
        expect(state.sessions[0].id).toBe(secondId);
        expect(state.sessions[1].id).toBe(firstId);
      });
    });

    describe('deleteSession', () => {
      it('removes the specified session', async () => {
        const sessionId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        mockDeleteResponse();
        await useChatStore.getState().deleteSession(sessionId);
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(0);
      });

      it('sets currentSessionId to first remaining session when deleting current session', async () => {
        const firstId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        const secondId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        expect(useChatStore.getState().currentSessionId).toBe(secondId);

        mockDeleteResponse();
        await useChatStore.getState().deleteSession(secondId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(firstId);
        expect(state.sessions).toHaveLength(1);
      });

      it('sets currentSessionId to null when deleting the last session', async () => {
        const sessionId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        mockDeleteResponse();
        await useChatStore.getState().deleteSession(sessionId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBeNull();
        expect(state.sessions).toHaveLength(0);
      });
    });

    describe('setCurrentSession', () => {
      it('updates currentSessionId', async () => {
        const firstId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        useChatStore.getState().setCurrentSession(firstId);
        const state = useChatStore.getState();

        expect(state.currentSessionId).toBe(firstId);
      });
    });

    describe('updateSessionTitle', () => {
      it('updates the title of the specified session', async () => {
        const sessionId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();

        const newTitle = 'Updated Title';
        mockUpdateTitleResponse(sessionId, newTitle);
        await useChatStore.getState().updateSessionTitle(sessionId, newTitle);
        const state = useChatStore.getState();

        expect(state.sessions[0].title).toBe(newTitle);
      });
    });

    describe('loadSessions', () => {
      it('loads sessions from API', async () => {
        const sessions = [
          {
            id: 'session-1',
            title: 'Session 1',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'session-2',
            title: 'Session 2',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        mockListSessionsResponse(sessions);

        await useChatStore.getState().loadSessions();
        const state = useChatStore.getState();

        expect(state.sessions).toHaveLength(2);
        expect(state.isLoadingSessions).toBe(false);
      });
    });

    describe('getCurrentSession', () => {
      it('returns the current session', async () => {
        const sessionId = mockCreateSessionResponse();
        await useChatStore.getState().createSession();
        const currentSession = useChatStore.getState().getCurrentSession();

        expect(currentSession).not.toBeNull();
        expect(currentSession?.id).toBe(sessionId);
      });

      it('returns null when no current session', () => {
        const currentSession = useChatStore.getState().getCurrentSession();
        expect(currentSession).toBeNull();
      });

      it('returns null when currentSessionId does not match any session', async () => {
        mockCreateSessionResponse();
        await useChatStore.getState().createSession();
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
    });

    describe('Selected Workflow', () => {
      it('sets selected workflow and opens preview when workflow is selected', () => {
        useChatStore.getState().setSelectedWorkflow('workflow-123');
        const state = useChatStore.getState();

        expect(state.selectedWorkflowId).toBe('workflow-123');
        expect(state.isWorkflowPreviewOpen).toBe(true);
      });

      it('clears selected workflow and closes preview when set to null', () => {
        useChatStore.getState().setSelectedWorkflow('workflow-123');
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

  describe('Persistence (partialize)', () => {
    it('partializes only currentSessionId and isSidebarOpen', () => {
      useChatStore.setState({
        currentSessionId: 'session-123',
        isSidebarOpen: false,
        isCommandPaletteOpen: true,
        isWorkflowPreviewOpen: true,
        selectedWorkflowId: 'workflow-123',
      });

      const partialize = useChatStore.persist.getOptions().partialize!;
      const persisted = partialize(useChatStore.getState()) as Record<string, any>;

      expect(persisted.currentSessionId).toBe('session-123');
      expect(persisted.isSidebarOpen).toBe(false);

      // Sessions are no longer persisted to localStorage (server is source of truth)
      expect('sessions' in persisted).toBe(false);
      expect('isCommandPaletteOpen' in persisted).toBe(false);
      expect('isWorkflowPreviewOpen' in persisted).toBe(false);
      expect('selectedWorkflowId' in persisted).toBe(false);
    });
  });
});
