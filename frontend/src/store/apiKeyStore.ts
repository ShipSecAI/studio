import { create } from 'zustand';
import { api } from '@/services/api';
import type { components } from '@shipsec/backend-client';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];
type CreateApiKeyResponseDto = components['schemas']['CreateApiKeyResponseDto'];
type CreateApiKeyDto = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyDto = components['schemas']['UpdateApiKeyDto'];

interface ApiKeyStoreState {
  apiKeys: ApiKeyResponseDto[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  lastCreatedKey: string | null; // Store the plaintext key temporarily
}

interface ApiKeyStoreActions {
  fetchApiKeys: (force?: boolean) => Promise<void>;
  createApiKey: (input: CreateApiKeyDto) => Promise<CreateApiKeyResponseDto>;
  updateApiKey: (id: string, input: UpdateApiKeyDto) => Promise<ApiKeyResponseDto>;
  revokeApiKey: (id: string) => Promise<ApiKeyResponseDto>;
  deleteApiKey: (id: string) => Promise<void>;
  getApiKeyById: (id: string) => ApiKeyResponseDto | undefined;
  clearLastCreatedKey: () => void;
  reset: () => void;
}

type ApiKeyStore = ApiKeyStoreState & ApiKeyStoreActions;

export const useApiKeyStore = create<ApiKeyStore>((set, get) => ({
  apiKeys: [],
  loading: false,
  error: null,
  initialized: false,
  lastCreatedKey: null,

  fetchApiKeys: async (force = false) => {
    const { loading, initialized } = get();
    if (loading || (!force && initialized)) {
      return;
    }

    set({ loading: true, error: null });
    try {
      const apiKeys = await api.apiKeys.list();
      set({
        apiKeys: apiKeys.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
        loading: false,
        error: null,
        initialized: true,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load API keys',
        loading: false,
      });
    }
  },

  createApiKey: async (input: CreateApiKeyDto) => {
    set({ loading: true, error: null });
    try {
      const created = await api.apiKeys.create(input);
      // The backend returns the plain key only in the creation response one time.
      // CreateApiKeyResponseDto includes plainKey field.
      const plainKey = created.plainKey;

      set((state) => ({
        apiKeys: [created, ...state.apiKeys],
        lastCreatedKey: plainKey || null,
        loading: false,
        error: null,
      }));
      return created;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create API key';
      set({ error: message, loading: false });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  updateApiKey: async (id: string, input: UpdateApiKeyDto) => {
    set({ error: null });
    try {
      const updated = await api.apiKeys.update(id, input);
      set((state) => ({
        apiKeys: state.apiKeys.map((key) => (key.id === id ? updated : key)),
        error: null,
      }));
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update API key';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  revokeApiKey: async (id: string) => {
    set({ error: null });
    try {
      const revoked = await api.apiKeys.revoke(id);
      set((state) => ({
        apiKeys: state.apiKeys.map((key) => (key.id === id ? revoked : key)),
        error: null,
      }));
      return revoked;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke API key';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  deleteApiKey: async (id: string) => {
    set({ error: null });
    try {
      await api.apiKeys.delete(id);
      set((state) => ({
        apiKeys: state.apiKeys.filter((key) => key.id !== id),
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete API key';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  getApiKeyById: (id: string) => {
    return get().apiKeys.find((key) => key.id === id);
  },

  clearLastCreatedKey: () => {
    set({ lastCreatedKey: null });
  },

  reset: () => {
    set({
      apiKeys: [],
      error: null,
      initialized: false,
      lastCreatedKey: null,
      loading: false,
    });
  },
}));
