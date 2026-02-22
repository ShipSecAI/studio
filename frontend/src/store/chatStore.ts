import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

export interface SuggestedPrompt {
  id: string;
  icon: string;
  label: string;
  prompt: string;
  category: 'workflow' | 'code' | 'learn' | 'general';
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  command: string;
  category: 'workflow' | 'navigation' | 'settings';
}

interface ChatState {
  // Sessions (from server)
  sessions: ChatSession[];
  currentSessionId: string | null;
  isLoadingSessions: boolean;

  // UI State
  isCommandPaletteOpen: boolean;
  isWorkflowPreviewOpen: boolean;
  selectedWorkflowId: string | null;
  isRunInspectorOpen: boolean;
  selectedRunId: string | null;
  isSidebarOpen: boolean;

  // Server-backed actions (async)
  loadSessions: () => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  setCurrentSession: (id: string) => void;
  startNewConversation: () => void;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;

  // UI Actions
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleWorkflowPreview: () => void;
  setWorkflowPreviewOpen: (open: boolean) => void;
  setSelectedWorkflow: (id: string | null) => void;
  toggleRunInspector: () => void;
  setRunInspectorOpen: (open: boolean) => void;
  setSelectedRun: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Getters
  getCurrentSession: () => ChatSession | null;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = await getApiAuthHeaders();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  // DELETE returns 200 with { success: true }, handle empty/non-JSON
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      isLoadingSessions: false,
      isCommandPaletteOpen: false,
      isWorkflowPreviewOpen: false,
      selectedWorkflowId: null,
      isRunInspectorOpen: false,
      selectedRunId: null,
      isSidebarOpen: true,

      loadSessions: async () => {
        set({ isLoadingSessions: true });
        try {
          const sessions = await fetchJson<ChatSession[]>(`${API_V1_URL}/chat/sessions`);
          // Clear currentSessionId if it points to a deleted session
          const { currentSessionId } = get();
          const sessionExists =
            !currentSessionId || sessions.some((s) => s.id === currentSessionId);
          set({
            sessions,
            isLoadingSessions: false,
            ...(sessionExists ? {} : { currentSessionId: null }),
          });
        } catch {
          set({ isLoadingSessions: false });
        }
      },

      createSession: async (title?: string) => {
        const session = await fetchJson<ChatSession>(`${API_V1_URL}/chat/sessions`, {
          method: 'POST',
          body: JSON.stringify(title ? { title } : {}),
        });
        set((state) => ({
          sessions: [session, ...state.sessions.filter((s) => s.id !== session.id)],
          currentSessionId: session.id,
        }));
        return session.id;
      },

      deleteSession: async (id) => {
        await fetchJson(`${API_V1_URL}/chat/sessions/${id}`, { method: 'DELETE' });
        set((state) => {
          const filteredSessions = state.sessions.filter((s) => s.id !== id);
          const newCurrentId =
            state.currentSessionId === id
              ? (filteredSessions[0]?.id ?? null)
              : state.currentSessionId;
          return {
            sessions: filteredSessions,
            currentSessionId: newCurrentId,
          };
        });
      },

      setCurrentSession: (id) => {
        set({ currentSessionId: id });
      },

      startNewConversation: () => {
        set({ currentSessionId: null });
      },

      updateSessionTitle: async (sessionId, title) => {
        const updated = await fetchJson<ChatSession>(`${API_V1_URL}/chat/sessions/${sessionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
        });
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, title: updated.title, updatedAt: updated.updatedAt } : s,
          ),
        }));
      },

      toggleCommandPalette: () => {
        set((state) => ({ isCommandPaletteOpen: !state.isCommandPaletteOpen }));
      },

      setCommandPaletteOpen: (open) => {
        set({ isCommandPaletteOpen: open });
      },

      toggleWorkflowPreview: () => {
        set((state) => ({ isWorkflowPreviewOpen: !state.isWorkflowPreviewOpen }));
      },

      setWorkflowPreviewOpen: (open) => {
        set({ isWorkflowPreviewOpen: open });
      },

      setSelectedWorkflow: (id) => {
        set({ selectedWorkflowId: id, isWorkflowPreviewOpen: id !== null });
      },

      toggleRunInspector: () => {
        set((state) => ({ isRunInspectorOpen: !state.isRunInspectorOpen }));
      },

      setRunInspectorOpen: (open) => {
        set({ isRunInspectorOpen: open });
      },

      setSelectedRun: (id) => {
        set({ selectedRunId: id, isRunInspectorOpen: id !== null });
      },

      toggleSidebar: () => {
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
      },

      setSidebarOpen: (open) => {
        set({ isSidebarOpen: open });
      },

      getCurrentSession: () => {
        const state = get();
        return state.sessions.find((s) => s.id === state.currentSessionId) ?? null;
      },
    }),
    {
      name: 'shipsec-chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        isSidebarOpen: state.isSidebarOpen,
      }),
    },
  ),
);

// Default suggested prompts
export const defaultSuggestedPrompts: SuggestedPrompt[] = [
  {
    id: 'create-workflow',
    icon: 'Workflow',
    label: 'Create a workflow',
    prompt: 'Help me create a new workflow that',
    category: 'workflow',
  },
  {
    id: 'analyze-code',
    icon: 'Code',
    label: 'Analyze code',
    prompt: 'Analyze this code and suggest improvements:',
    category: 'code',
  },
  {
    id: 'learn-concepts',
    icon: 'GraduationCap',
    label: 'Learn concepts',
    prompt: 'Explain to me how',
    category: 'learn',
  },
  {
    id: 'debug-issue',
    icon: 'Bug',
    label: 'Debug an issue',
    prompt: 'Help me debug this issue:',
    category: 'code',
  },
  {
    id: 'surprise-me',
    icon: 'Sparkles',
    label: 'Surprise me',
    prompt: 'Show me something interesting I can build with ShipSec',
    category: 'general',
  },
];

// Default quick actions
export const defaultQuickActions: QuickAction[] = [
  {
    id: 'new-workflow',
    label: 'New Workflow',
    description: 'Create a new automation workflow',
    icon: 'Plus',
    command: '/new-workflow',
    category: 'workflow',
  },
  {
    id: 'run-workflow',
    label: 'Run Workflow',
    description: 'Execute an existing workflow',
    icon: 'Play',
    command: '/run',
    category: 'workflow',
  },
  {
    id: 'view-history',
    label: 'View Run History',
    description: 'See recent workflow executions',
    icon: 'History',
    command: '/history',
    category: 'workflow',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Open application settings',
    icon: 'Settings',
    command: '/settings',
    category: 'settings',
  },
  {
    id: 'help',
    label: 'Help',
    description: 'Get help and documentation',
    icon: 'HelpCircle',
    command: '/help',
    category: 'navigation',
  },
];
