import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    workflowId?: string;
    workflowName?: string;
    isLoading?: boolean;
    error?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
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
  // Sessions
  sessions: ChatSession[];
  currentSessionId: string | null;

  // UI State
  isCommandPaletteOpen: boolean;
  isWorkflowPreviewOpen: boolean;
  selectedWorkflowId: string | null;
  isSidebarOpen: boolean;

  // Actions
  createSession: () => string;
  deleteSession: (id: string) => void;
  setCurrentSession: (id: string) => void;
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  clearSession: (sessionId: string) => void;

  // UI Actions
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleWorkflowPreview: () => void;
  setWorkflowPreviewOpen: (open: boolean) => void;
  setSelectedWorkflow: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Getters
  getCurrentSession: () => ChatSession | null;
  getSessionMessages: (sessionId: string) => ChatMessage[];
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createNewSession = (): ChatSession => ({
  id: generateId(),
  title: 'New Conversation',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  isActive: true,
});

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      isCommandPaletteOpen: false,
      isWorkflowPreviewOpen: false,
      selectedWorkflowId: null,
      isSidebarOpen: true,

      createSession: () => {
        const newSession = createNewSession();
        set((state) => ({
          sessions: [newSession, ...state.sessions.map((s) => ({ ...s, isActive: false }))],
          currentSessionId: newSession.id,
        }));
        return newSession.id;
      },

      deleteSession: (id) => {
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
        set((state) => ({
          currentSessionId: id,
          sessions: state.sessions.map((s) => ({
            ...s,
            isActive: s.id === id,
          })),
        }));
      },

      addMessage: (sessionId, message) => {
        const newMessage: ChatMessage = {
          ...message,
          id: generateId(),
          timestamp: new Date(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;

            const updatedMessages = [...session.messages, newMessage];

            // Auto-generate title from first user message
            let title = session.title;
            if (session.title === 'New Conversation' && message.role === 'user') {
              title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
            }

            return {
              ...session,
              messages: updatedMessages,
              title,
              updatedAt: new Date(),
            };
          }),
        }));
      },

      updateMessage: (sessionId, messageId, updates) => {
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;
            return {
              ...session,
              messages: session.messages.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg,
              ),
              updatedAt: new Date(),
            };
          }),
        }));
      },

      updateSessionTitle: (sessionId, title) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, title, updatedAt: new Date() } : session,
          ),
        }));
      },

      clearSession: (sessionId) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: [], title: 'New Conversation', updatedAt: new Date() }
              : session,
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

      getSessionMessages: (sessionId) => {
        const session = get().sessions.find((s) => s.id === sessionId);
        return session?.messages ?? [];
      },
    }),
    {
      name: 'shipsec-chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
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
