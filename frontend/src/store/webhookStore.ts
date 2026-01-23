import { create } from 'zustand';
import type { WebhookConfiguration, WebhookDelivery } from '@shipsec/shared';
import { API_V1_URL } from '@/services/api';

type WebhookStatusFilter = 'all' | 'active' | 'inactive';

interface WebhookFilters {
  workflowId: string | null;
  status: WebhookStatusFilter;
  search: string;
}

interface WebhookStoreState {
  webhooks: WebhookConfiguration[];
  deliveries: Record<string, WebhookDelivery[]>;
  isLoading: boolean;
  isDeliveriesLoading: Record<string, boolean>;
  error: string | null;
  lastFetched: number | null;
  filters: WebhookFilters;
}

interface WebhookStoreActions {
  fetchWebhooks: (options?: { force?: boolean }) => Promise<WebhookConfiguration[]>;
  refreshWebhooks: () => Promise<WebhookConfiguration[]>;
  setFilters: (filters: Partial<WebhookFilters>) => void;
  deleteWebhook: (id: string) => Promise<void>;
  upsertWebhook: (webhook: WebhookConfiguration) => void;
  regeneratePath: (id: string) => Promise<{ id: string; webhookPath: string; url: string }>;
  testScript: (dto: {
    parsingScript: string;
    testPayload: Record<string, unknown>;
    testHeaders?: Record<string, string>;
    webhookId?: string;
  }) => Promise<{
    success: boolean;
    parsedData: Record<string, unknown> | null;
    errorMessage: string | null;
    validationErrors?: { inputId: string; message: string }[];
  }>;
  fetchDeliveries: (webhookId: string) => Promise<WebhookDelivery[]>;
  setError: (message: string | null) => void;
}

export type WebhookStore = WebhookStoreState & WebhookStoreActions;

const STALE_MS = 15_000;

const INITIAL_FILTERS: WebhookFilters = {
  workflowId: null,
  status: 'all',
  search: '',
};

const createInitialState = (): WebhookStoreState => ({
  webhooks: [],
  deliveries: {},
  isLoading: false,
  isDeliveriesLoading: {},
  error: null,
  lastFetched: null,
  filters: { ...INITIAL_FILTERS },
});

async function fetchWithHeaders(url: string, options: RequestInit = {}): Promise<Response> {
  const { getApiAuthHeaders } = await import('@/services/api');
  const headers = await getApiAuthHeaders();

  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export const useWebhookStore = create<WebhookStore>((set, get) => ({
  ...createInitialState(),

  fetchWebhooks: async (options) => {
    const { lastFetched, isLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched && Date.now() - lastFetched < STALE_MS;

    if (!force && !isLoading && isFresh) {
      return get().webhooks;
    }

    if (!isLoading) {
      set({ isLoading: true, error: null });
    }

    try {
      const response = await fetchWithHeaders(`${API_V1_URL}/webhooks/configurations`);
      if (!response.ok) {
        throw new Error('Failed to fetch webhooks');
      }
      const webhooks = await response.json();
      set({
        webhooks,
        isLoading: false,
        error: null,
        lastFetched: Date.now(),
      });
      return webhooks;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch webhooks';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  refreshWebhooks: () => get().fetchWebhooks({ force: true }),

  setFilters: (partial) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }));
  },

  deleteWebhook: async (id: string) => {
    const response = await fetchWithHeaders(`${API_V1_URL}/webhooks/configurations/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete webhook');
    }
    set((state) => ({
      webhooks: state.webhooks.filter((webhook) => webhook.id !== id),
    }));
  },

  upsertWebhook: (webhook) => {
    set((state) => {
      const exists = state.webhooks.some((item) => item.id === webhook.id);
      if (!exists) {
        return { webhooks: [...state.webhooks, webhook] };
      }
      return {
        webhooks: state.webhooks.map((item) => (item.id === webhook.id ? webhook : item)),
      };
    });
  },

  regeneratePath: async (id: string) => {
    const response = await fetchWithHeaders(
      `${API_V1_URL}/webhooks/configurations/${id}/regenerate-path`,
      {
        method: 'POST',
      },
    );
    if (!response.ok) {
      throw new Error('Failed to regenerate webhook path');
    }
    const result = await response.json();

    // Update the webhook in the store
    set((state) => ({
      webhooks: state.webhooks.map((w) =>
        w.id === id ? { ...w, webhookPath: result.webhookPath } : w,
      ),
    }));

    return result;
  },

  testScript: async (dto) => {
    const response = await fetchWithHeaders(`${API_V1_URL}/webhooks/configurations/test-script`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    if (!response.ok) {
      throw new Error('Failed to test parsing script');
    }
    return response.json();
  },

  fetchDeliveries: async (webhookId: string) => {
    set((state) => ({
      isDeliveriesLoading: { ...state.isDeliveriesLoading, [webhookId]: true },
    }));

    try {
      const response = await fetchWithHeaders(
        `${API_V1_URL}/webhooks/configurations/${webhookId}/deliveries`,
      );
      if (!response.ok) {
        throw new Error('Failed to fetch deliveries');
      }
      const deliveries = await response.json();

      set((state) => ({
        deliveries: { ...state.deliveries, [webhookId]: deliveries },
        isDeliveriesLoading: { ...state.isDeliveriesLoading, [webhookId]: false },
      }));

      return deliveries;
    } catch (error) {
      set((state) => ({
        isDeliveriesLoading: { ...state.isDeliveriesLoading, [webhookId]: false },
      }));
      throw error;
    }
  },

  setError: (message) => {
    set({ error: message });
  },
}));

export const resetWebhookStoreState = () => {
  useWebhookStore.setState({ ...createInitialState() });
};
