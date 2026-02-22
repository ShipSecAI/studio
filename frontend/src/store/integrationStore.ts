import { create } from 'zustand';
import { api } from '@/services/api';
import type { IntegrationConnection, IntegrationCatalogEntry } from '@/services/api';

interface AwsSetupInfoCache {
  platformRoleArn: string;
  externalId: string;
  setupToken: string;
  trustPolicyTemplate: string;
  externalIdDisplay?: string;
  fetchedAt: number; // Date.now() when fetched
}

// Setup token TTL is 30 min on the backend; use 25 min as a safe margin
const AWS_SETUP_INFO_TTL_MS = 25 * 60 * 1000;

interface IntegrationStoreState {
  orgConnections: IntegrationConnection[];
  catalog: IntegrationCatalogEntry[];
  loadingOrgConnections: boolean;
  loadingCatalog: boolean;
  error: string | null;
  orgInitialized: boolean;
  /** Track which org the cache is for — invalidate on org switch */
  _cachedOrgId: string | null;
  _awsSetupInfoCache: AwsSetupInfoCache | null;
}

interface IntegrationStoreActions {
  // D6: org-scoped connection listing (primary source of truth)
  fetchOrgConnections: (provider?: string, force?: boolean) => Promise<void>;
  refreshConnection: (id: string) => Promise<IntegrationConnection>;
  disconnect: (id: string) => Promise<void>;
  upsertConnection: (connection: IntegrationConnection) => void;
  // AWS setup info
  getAwsSetupInfo: () => Promise<{
    platformRoleArn: string;
    externalId: string;
    setupToken: string;
    trustPolicyTemplate: string;
    externalIdDisplay?: string;
  }>;
  // New connection creation (IAM role only)
  createAwsConnection: (payload: {
    displayName: string;
    roleArn: string;
    region?: string;
    externalId: string;
    setupToken: string;
  }) => Promise<IntegrationConnection>;
  createSlackWebhookConnection: (payload: {
    displayName: string;
    webhookUrl: string;
  }) => Promise<IntegrationConnection>;
  validateAwsConnection: (id: string) => Promise<{ valid: boolean; error?: string }>;
  testSlackConnection: (id: string) => Promise<{ ok: boolean; error?: string }>;
  discoverOrgAccounts: (
    id: string,
  ) => Promise<{ accounts: { id: string; name: string; status: string; email?: string }[] }>;
  fetchCatalog: () => Promise<void>;
  resetError: () => void;
  /** Reset store when org changes */
  resetForOrgSwitch: () => void;
}

type IntegrationStore = IntegrationStoreState & IntegrationStoreActions;

function sortConnections(connections: IntegrationConnection[]) {
  return [...connections].sort((a, b) => {
    const providerCmp = (a.providerName ?? a.provider).localeCompare(b.providerName ?? b.provider);
    if (providerCmp !== 0) return providerCmp;
    return (a.displayName ?? '').localeCompare(b.displayName ?? '');
  });
}

export const useIntegrationStore = create<IntegrationStore>((set, get) => ({
  orgConnections: [],
  catalog: [],
  loadingOrgConnections: false,
  loadingCatalog: false,
  error: null,
  orgInitialized: false,
  _cachedOrgId: null,
  _awsSetupInfoCache: null,

  fetchOrgConnections: async (provider?: string, force = false) => {
    const { loadingOrgConnections, orgInitialized } = get();
    if (loadingOrgConnections || (!force && orgInitialized)) {
      return;
    }

    set({ loadingOrgConnections: true, error: null });
    try {
      const orgConnections = await api.integrations.listOrgConnections(provider);
      set({
        orgConnections: sortConnections(orgConnections),
        loadingOrgConnections: false,
        orgInitialized: true,
      });
    } catch (error) {
      set({
        loadingOrgConnections: false,
        error: error instanceof Error ? error.message : 'Failed to load org connections',
      });
    }
  },

  upsertConnection: (connection: IntegrationConnection) => {
    set((state) => ({
      orgConnections: sortConnections(
        state.orgConnections.some((item) => item.id === connection.id)
          ? state.orgConnections.map((item) => (item.id === connection.id ? connection : item))
          : [...state.orgConnections, connection],
      ),
    }));
  },

  refreshConnection: async (id: string) => {
    try {
      const refreshed = await api.integrations.refreshConnection(id);
      set((state) => ({
        orgConnections: sortConnections(
          state.orgConnections.map((c) => (c.id === id ? refreshed : c)),
        ),
      }));
      return refreshed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh integration token';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  disconnect: async (id: string) => {
    try {
      await api.integrations.disconnect(id);
      set((state) => ({
        orgConnections: state.orgConnections.filter((c) => c.id !== id),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect integration';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  getAwsSetupInfo: async () => {
    const cached = get()._awsSetupInfoCache;
    if (cached && Date.now() - cached.fetchedAt < AWS_SETUP_INFO_TTL_MS) {
      const { fetchedAt: _, ...info } = cached;
      return info;
    }
    const info = await api.integrations.getAwsSetupInfo();
    set({ _awsSetupInfoCache: { ...info, fetchedAt: Date.now() } });
    return info;
  },

  createAwsConnection: async (payload) => {
    try {
      const connection = await api.integrations.createAwsConnection(payload);
      set({ _awsSetupInfoCache: null }); // clear so next connection gets a fresh setup token
      get().upsertConnection(connection);
      return connection;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create AWS connection';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  createSlackWebhookConnection: async (payload) => {
    try {
      const connection = await api.integrations.createSlackWebhookConnection(payload);
      get().upsertConnection(connection);
      return connection;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Slack connection';
      set({ error: message });
      throw error instanceof Error ? error : new Error(message);
    }
  },

  validateAwsConnection: async (id: string) => {
    return api.integrations.validateAwsConnection(id);
  },

  testSlackConnection: async (id: string) => {
    return api.integrations.testSlackConnection(id);
  },

  discoverOrgAccounts: async (id: string) => {
    return api.integrations.discoverOrgAccounts(id);
  },

  fetchCatalog: async () => {
    if (get().loadingCatalog) return;
    set({ loadingCatalog: true, error: null });
    try {
      const catalog = await api.integrations.getCatalog();
      set({ catalog, loadingCatalog: false });
    } catch (error) {
      set({
        loadingCatalog: false,
        error: error instanceof Error ? error.message : 'Failed to load catalog',
      });
    }
  },

  resetError: () => {
    set({ error: null });
  },

  resetForOrgSwitch: () => {
    set({
      orgConnections: [],
      orgInitialized: false,
      _cachedOrgId: null,
      _awsSetupInfoCache: null,
      error: null,
    });
  },
}));
