import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface ChatStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;

  // Actions
  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setMessages: (
    conversationId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ) => void;
  getActiveConversation: () => Conversation | null;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, newTitle: string) => void;
  clearConversations: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

// Rehydrate Date objects from JSON strings
function rehydrateDates(conversations: Conversation[]): Conversation[] {
  return conversations.map((conv) => ({
    ...conv,
    createdAt: new Date(conv.createdAt),
    updatedAt: new Date(conv.updatedAt),
    messages: conv.messages.map((msg) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    })),
  }));
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      isLoading: false,

      createConversation: () => {
        const id = generateId();
        const newConversation: Conversation = {
          id,
          title: 'New conversation',
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: id,
        }));
        return id;
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      addMessage: (conversationId, message) => {
        const id = generateId();
        const newMessage: ChatMessage = {
          ...message,
          id,
          timestamp: new Date(),
        };

        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id === conversationId) {
              // Update title based on first user message
              const newTitle =
                conv.messages.length === 0 && message.role === 'user'
                  ? message.content.slice(0, 30) + (message.content.length > 30 ? '...' : '')
                  : conv.title;
              return {
                ...conv,
                title: newTitle,
                messages: [...conv.messages, newMessage],
                updatedAt: new Date(),
              };
            }
            return conv;
          }),
        }));
      },

      setMessages: (conversationId, messages) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id === conversationId) {
              return {
                ...conv,
                messages: messages.map((msg) => ({
                  ...msg,
                  id: generateId(),
                  timestamp: new Date(),
                })),
                updatedAt: new Date(),
              };
            }
            return conv;
          }),
        }));
      },

      getActiveConversation: () => {
        const state = get();
        return state.conversations.find((c) => c.id === state.activeConversationId) || null;
      },

      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
        }));
      },

      renameConversation: (id, newTitle) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, title: newTitle, updatedAt: new Date() } : conv,
          ),
        }));
      },

      clearConversations: () => {
        set({ conversations: [], activeConversationId: null });
      },
    }),
    {
      name: 'shipsec-chat-store',
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.conversations = rehydrateDates(state.conversations);
        }
      },
    },
  ),
);
