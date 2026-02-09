import { create } from 'zustand';
import type { McpHealthStatus, CreateMcpServer, UpdateMcpServer } from '@shipsec/shared';
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';

// API response types (matching backend DTOs)
export interface McpServerResponse {
  id: string;
  name: string;
  description?: string | null;
  transportType: 'http' | 'stdio';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  hasHeaders: boolean;
  headerKeys?: string[] | null;
  enabled: boolean;
  healthCheckUrl?: string | null;
  lastHealthCheck?: string | null;
  lastHealthStatus?: McpHealthStatus | null;
  createdAt: string;
  updatedAt: string;
  groupId?: string | null;
}

export interface McpToolResponse {
  id: string;
  toolName: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  serverId: string;
  serverName: string;
  enabled: boolean;
  discoveredAt: string;
}

interface TestConnectionResponse {
  success: boolean;
  message?: string;
  toolCount?: number;
}

// Store state
interface McpServerFilters {
  search: string;
  enabledOnly: boolean;
}

interface McpServerStoreState {
  servers: McpServerResponse[];
  tools: McpToolResponse[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
  filters: McpServerFilters;
}

interface McpServerStoreActions {
  // Server CRUD
  fetchServers: (options?: { force?: boolean }) => Promise<McpServerResponse[]>;
  refreshServers: () => Promise<McpServerResponse[]>;
  createServer: (input: CreateMcpServer) => Promise<McpServerResponse>;
  updateServer: (id: string, input: UpdateMcpServer) => Promise<McpServerResponse>;
  deleteServer: (id: string) => Promise<void>;
  toggleServer: (id: string) => Promise<McpServerResponse>;
  testConnection: (id: string) => Promise<TestConnectionResponse>;

  // Tools
  fetchServerTools: (serverId: string) => Promise<McpToolResponse[]>;
  fetchAllTools: () => Promise<McpToolResponse[]>;
  discoverTools: (serverId: string, options?: { image?: string }) => Promise<McpToolResponse[]>;
  toggleTool: (serverId: string, toolId: string) => Promise<McpToolResponse>;

  // Filters
  setFilters: (filters: Partial<McpServerFilters>) => void;

  // Local state
  upsertServer: (server: McpServerResponse) => void;
  removeServer: (id: string) => void;
  setError: (message: string | null) => void;
}

export type McpServerStore = McpServerStoreState & McpServerStoreActions;

const STALE_MS = 15_000;

const INITIAL_FILTERS: McpServerFilters = {
  search: '',
  enabledOnly: false,
};

const createInitialState = (): McpServerStoreState => ({
  servers: [],
  tools: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  filters: { ...INITIAL_FILTERS },
});

// API helpers
async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getApiAuthHeaders();
  const { signal, ...restOptions } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...restOptions,
    signal,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const useMcpServerStore = create<McpServerStore>((set, get) => ({
  ...createInitialState(),

  fetchServers: async (options) => {
    const { lastFetched, isLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched && Date.now() - lastFetched < STALE_MS;

    if (!force && !isLoading && isFresh) {
      return get().servers;
    }

    if (!isLoading) {
      set({ isLoading: true, error: null });
    }

    try {
      const servers = await apiRequest<McpServerResponse[]>('/api/v1/mcp-servers');

      set({
        servers,
        isLoading: false,
        error: null,
        lastFetched: Date.now(),
      });
      return servers;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch MCP servers';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  refreshServers: () => get().fetchServers({ force: true }),

  createServer: async (input) => {
    const server = await apiRequest<McpServerResponse>('/api/v1/mcp-servers', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    set((state) => ({
      servers: [...state.servers, server],
    }));

    return server;
  },

  updateServer: async (id, input) => {
    const server = await apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });

    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? server : s)),
    }));

    return server;
  },

  deleteServer: async (id) => {
    await apiRequest(`/api/v1/mcp-servers/${id}`, { method: 'DELETE' });

    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      tools: state.tools.filter((t) => t.serverId !== id),
    }));
  },

  toggleServer: async (id) => {
    const server = await apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}/toggle`, {
      method: 'POST',
    });

    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? server : s)),
    }));

    return server;
  },

  testConnection: async (id) => {
    return apiRequest<TestConnectionResponse>(`/api/v1/mcp-servers/${id}/test`, {
      method: 'POST',
    });
  },

  fetchServerTools: async (serverId) => {
    const tools = await apiRequest<McpToolResponse[]>(`/api/v1/mcp-servers/${serverId}/tools`);

    set((state) => ({
      tools: [...state.tools.filter((t) => t.serverId !== serverId), ...tools],
    }));

    return tools;
  },

  fetchAllTools: async () => {
    const tools = await apiRequest<McpToolResponse[]>('/api/v1/mcp-servers/tools');
    set({ tools });
    return tools;
  },

  discoverTools: async (serverId, options) => {
    // Get server config from store
    const server = get().servers.find((s) => s.id === serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Start discovery workflow
    const { workflowId } = await mcpDiscoveryApi.discover({
      transport: server.transportType,
      name: server.name,
      endpoint: server.endpoint ?? undefined,
      command: server.command ?? undefined,
      args: server.args ?? undefined,
      image: options?.image,
    });

    // Poll for completion with 60-second timeout
    const maxAttempts = 60; // 60 seconds with 1-second intervals
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await mcpDiscoveryApi.getStatus(workflowId);

      if (status.status === 'completed' && status.tools) {
        // Transform tools to match store format
        const tools: McpToolResponse[] = status.tools.map((tool) => ({
          id: `${serverId}-${tool.name}`,
          toolName: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
          serverId,
          serverName: server.name,
          enabled: true,
          discoveredAt: new Date().toISOString(),
        }));

        set((state) => ({
          tools: [...state.tools.filter((t) => t.serverId !== serverId), ...tools],
        }));

        return tools;
      }

      if (status.status === 'failed') {
        throw new Error(status.error ?? 'Discovery failed');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Discovery timed out after 60 seconds');
  },

  toggleTool: async (serverId, toolId) => {
    const tool = await apiRequest<McpToolResponse>(
      `/api/v1/mcp-servers/${serverId}/tools/${toolId}/toggle`,
      { method: 'POST' },
    );

    set((state) => ({
      tools: state.tools.map((t) => (t.id === toolId ? tool : t)),
    }));

    return tool;
  },

  setFilters: (partial) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }));
  },

  upsertServer: (server) => {
    set((state) => {
      const exists = state.servers.some((s) => s.id === server.id);
      if (!exists) {
        return {
          servers: [...state.servers, server],
        };
      }
      return {
        servers: state.servers.map((s) => (s.id === server.id ? server : s)),
      };
    });
  },

  removeServer: (id) => {
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      tools: state.tools.filter((t) => t.serverId !== id),
    }));
  },

  setError: (message) => {
    set({ error: message });
  },
}));

// Selector hooks for common use cases
export const useEnabledMcpServers = () =>
  useMcpServerStore((state) => state.servers.filter((s) => s.enabled));

export const useHealthyMcpServers = () =>
  useMcpServerStore((state) =>
    state.servers.filter((s) => s.enabled && s.lastHealthStatus === 'healthy'),
  );

export const useMcpToolsByServer = (serverId: string) =>
  useMcpServerStore((state) => state.tools.filter((t) => t.serverId === serverId));

export const useEnabledMcpTools = () =>
  useMcpServerStore((state) => {
    const enabledServerIds = new Set(state.servers.filter((s) => s.enabled).map((s) => s.id));
    return state.tools.filter((t) => enabledServerIds.has(t.serverId));
  });

export const resetMcpServerStoreState = () => {
  useMcpServerStore.setState({ ...createInitialState() });
};
