import { create } from 'zustand';
import type { McpHealthStatus } from '@shipsec/shared';
import {
  mcpGroupsApi,
  type McpGroupResponse,
  type McpGroupServerResponse,
} from '@/services/mcpGroupsApi';
import { useMcpServerStore } from '@/store/mcpServerStore';

// Store state
interface McpGroupStoreState {
  groups: McpGroupResponse[];
  groupServers: Map<string, McpGroupServerResponse[]>; // groupId -> servers
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
}

// Store actions
interface McpGroupStoreActions {
  // Groups
  fetchGroups: (options?: { force?: boolean }) => Promise<McpGroupResponse[]>;
  refreshGroups: () => Promise<McpGroupResponse[]>;

  // Group servers
  fetchGroupServers: (
    groupId: string,
    options?: { force?: boolean },
  ) => Promise<McpGroupServerResponse[]>;
  getGroupServers: (groupId: string) => McpGroupServerResponse[];

  // Health status (delegates to mcpServerStore)
  getHealthStatus: (serverId: string) => McpHealthStatus;

  // Local state
  setError: (message: string | null) => void;
}

export type McpGroupStore = McpGroupStoreState & McpGroupStoreActions;

const STALE_MS = 30_000; // Groups cache for 30 seconds

const createInitialState = (): McpGroupStoreState => ({
  groups: [],
  groupServers: new Map(),
  isLoading: false,
  error: null,
  lastFetched: null,
});

export const useMcpGroupStore = create<McpGroupStore>((set, get) => ({
  ...createInitialState(),

  fetchGroups: async (options) => {
    const { lastFetched, isLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched && Date.now() - lastFetched < STALE_MS;

    if (!force && !isLoading && isFresh) {
      return get().groups;
    }

    if (!isLoading) {
      set({ isLoading: true, error: null });
    }

    try {
      const groups = await mcpGroupsApi.listGroups();

      set({
        groups,
        isLoading: false,
        error: null,
        lastFetched: Date.now(),
      });

      return groups;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch MCP groups';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  refreshGroups: () => get().fetchGroups({ force: true }),

  fetchGroupServers: async (groupId, options) => {
    const { groupServers, isLoading } = get();
    const force = options?.force ?? false;
    const cached = groupServers.get(groupId);

    // Return cached servers if available and not forcing refresh
    if (!force && !isLoading && cached && cached.length > 0) {
      return cached;
    }

    if (!isLoading) {
      set({ isLoading: true, error: null });
    }

    try {
      const servers = await mcpGroupsApi.getGroupServers(groupId);

      set((state) => ({
        groupServers: new Map(state.groupServers).set(groupId, servers),
        isLoading: false,
        error: null,
      }));

      return servers;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch group servers';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  getGroupServers: (groupId) => {
    return get().groupServers.get(groupId) || [];
  },

  getHealthStatus: (serverId) => {
    // Get health status from the server's lastHealthStatus property
    const server = useMcpServerStore.getState().servers.find((s) => s.id === serverId);
    return server?.lastHealthStatus ?? 'unknown';
  },

  setError: (message) => {
    set({ error: message });
  },
}));

// Selector hooks for common use cases
export const useEnabledMcpGroups = () =>
  useMcpGroupStore((state) => state.groups.filter((g) => g.enabled));

export const useMcpGroupById = (groupId: string) =>
  useMcpGroupStore((state) => state.groups.find((g) => g.id === groupId));

export const useMcpGroupServers = (groupId: string) =>
  useMcpGroupStore((state) => state.groupServers.get(groupId) || []);

export const resetMcpGroupStoreState = () => {
  useMcpGroupStore.setState({ ...createInitialState() });
};
