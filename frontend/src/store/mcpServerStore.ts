import { create } from 'zustand'
import type {
  McpHealthStatus,
  CreateMcpServer,
  UpdateMcpServer,
} from '@shipsec/shared'
import { getApiAuthHeaders, API_BASE_URL } from '@/services/api'

// API response types (matching backend DTOs)
interface McpServerResponse {
  id: string
  name: string
  description?: string | null
  transportType: 'http' | 'stdio' | 'sse' | 'websocket'
  endpoint?: string | null
  command?: string | null
  args?: string[] | null
  hasHeaders: boolean
  enabled: boolean
  healthCheckUrl?: string | null
  lastHealthCheck?: string | null
  lastHealthStatus?: McpHealthStatus | null
  createdAt: string
  updatedAt: string
}

interface McpToolResponse {
  id: string
  toolName: string
  description?: string | null
  inputSchema?: Record<string, unknown> | null
  serverId: string
  serverName: string
  enabled: boolean
  discoveredAt: string
}

interface HealthStatusResponse {
  serverId: string
  status: McpHealthStatus
  checkedAt?: string | null
}

interface TestConnectionResponse {
  success: boolean
  message?: string
  toolCount?: number
}

// Store state
interface McpServerFilters {
  search: string
  enabledOnly: boolean
}

interface McpServerStoreState {
  servers: McpServerResponse[]
  tools: McpToolResponse[]
  healthStatus: Record<string, McpHealthStatus>
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  filters: McpServerFilters
}

interface McpServerStoreActions {
  // Server CRUD
  fetchServers: (options?: { force?: boolean }) => Promise<McpServerResponse[]>
  refreshServers: () => Promise<McpServerResponse[]>
  createServer: (input: CreateMcpServer) => Promise<McpServerResponse>
  updateServer: (id: string, input: UpdateMcpServer) => Promise<McpServerResponse>
  deleteServer: (id: string) => Promise<void>
  toggleServer: (id: string) => Promise<McpServerResponse>
  testConnection: (id: string) => Promise<TestConnectionResponse>

  // Tools
  fetchServerTools: (serverId: string) => Promise<McpToolResponse[]>
  fetchAllTools: () => Promise<McpToolResponse[]>
  discoverTools: (serverId: string) => Promise<McpToolResponse[]>
  toggleTool: (serverId: string, toolId: string) => Promise<McpToolResponse>

  // Health
  refreshHealth: () => Promise<void>

  // Filters
  setFilters: (filters: Partial<McpServerFilters>) => void

  // Local state
  upsertServer: (server: McpServerResponse) => void
  removeServer: (id: string) => void
  setError: (message: string | null) => void
}

export type McpServerStore = McpServerStoreState & McpServerStoreActions

const STALE_MS = 15_000

const INITIAL_FILTERS: McpServerFilters = {
  search: '',
  enabledOnly: false,
}

const createInitialState = (): McpServerStoreState => ({
  servers: [],
  tools: [],
  healthStatus: {},
  isLoading: false,
  error: null,
  lastFetched: null,
  filters: { ...INITIAL_FILTERS },
})

// API helpers
async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getApiAuthHeaders()
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || `Request failed: ${response.status}`)
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json()
}

export const useMcpServerStore = create<McpServerStore>((set, get) => ({
  ...createInitialState(),

  fetchServers: async (options) => {
    const { lastFetched, isLoading } = get()
    const force = options?.force ?? false
    const isFresh = lastFetched && Date.now() - lastFetched < STALE_MS

    if (!force && !isLoading && isFresh) {
      return get().servers
    }

    if (!isLoading) {
      set({ isLoading: true, error: null })
    }

    try {
      const servers = await apiRequest<McpServerResponse[]>('/api/v1/mcp-servers')

      // Build health status map from servers
      const healthStatus: Record<string, McpHealthStatus> = {}
      for (const server of servers) {
        healthStatus[server.id] = server.lastHealthStatus ?? 'unknown'
      }

      set({
        servers,
        healthStatus,
        isLoading: false,
        error: null,
        lastFetched: Date.now(),
      })
      return servers
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch MCP servers'
      set({ isLoading: false, error: message })
      throw error
    }
  },

  refreshServers: () => get().fetchServers({ force: true }),

  createServer: async (input) => {
    const server = await apiRequest<McpServerResponse>('/api/v1/mcp-servers', {
      method: 'POST',
      body: JSON.stringify(input),
    })

    set((state) => ({
      servers: [...state.servers, server],
      healthStatus: {
        ...state.healthStatus,
        [server.id]: server.lastHealthStatus ?? 'unknown',
      },
    }))

    return server
  },

  updateServer: async (id, input) => {
    const server = await apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })

    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? server : s)),
      healthStatus: {
        ...state.healthStatus,
        [server.id]: server.lastHealthStatus ?? 'unknown',
      },
    }))

    return server
  },

  deleteServer: async (id) => {
    await apiRequest(`/api/v1/mcp-servers/${id}`, { method: 'DELETE' })

    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      tools: state.tools.filter((t) => t.serverId !== id),
      healthStatus: Object.fromEntries(
        Object.entries(state.healthStatus).filter(([key]) => key !== id)
      ),
    }))
  },

  toggleServer: async (id) => {
    const server = await apiRequest<McpServerResponse>(`/api/v1/mcp-servers/${id}/toggle`, {
      method: 'POST',
    })

    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? server : s)),
    }))

    return server
  },

  testConnection: async (id) => {
    return apiRequest<TestConnectionResponse>(`/api/v1/mcp-servers/${id}/test`, {
      method: 'POST',
    })
  },

  fetchServerTools: async (serverId) => {
    const tools = await apiRequest<McpToolResponse[]>(`/api/v1/mcp-servers/${serverId}/tools`)

    set((state) => ({
      tools: [
        ...state.tools.filter((t) => t.serverId !== serverId),
        ...tools,
      ],
    }))

    return tools
  },

  fetchAllTools: async () => {
    const tools = await apiRequest<McpToolResponse[]>('/api/v1/mcp-servers/tools')
    set({ tools })
    return tools
  },

  discoverTools: async (serverId) => {
    const tools = await apiRequest<McpToolResponse[]>(`/api/v1/mcp-servers/${serverId}/discover`, {
      method: 'POST',
    })

    set((state) => ({
      tools: [
        ...state.tools.filter((t) => t.serverId !== serverId),
        ...tools,
      ],
    }))

    return tools
  },

  toggleTool: async (serverId, toolId) => {
    const tool = await apiRequest<McpToolResponse>(
      `/api/v1/mcp-servers/${serverId}/tools/${toolId}/toggle`,
      { method: 'POST' }
    )

    set((state) => ({
      tools: state.tools.map((t) => (t.id === toolId ? tool : t)),
    }))

    return tool
  },

  refreshHealth: async () => {
    try {
      const statuses = await apiRequest<HealthStatusResponse[]>('/api/v1/mcp-servers/health')

      const healthStatus: Record<string, McpHealthStatus> = {}
      for (const status of statuses) {
        healthStatus[status.serverId] = status.status
      }

      set({ healthStatus })
    } catch (error) {
      // Silently fail health refresh - don't break the UI
      console.error('Failed to refresh MCP server health:', error)
    }
  },

  setFilters: (partial) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }))
  },

  upsertServer: (server) => {
    set((state) => {
      const exists = state.servers.some((s) => s.id === server.id)
      if (!exists) {
        return {
          servers: [...state.servers, server],
          healthStatus: {
            ...state.healthStatus,
            [server.id]: server.lastHealthStatus ?? 'unknown',
          },
        }
      }
      return {
        servers: state.servers.map((s) => (s.id === server.id ? server : s)),
        healthStatus: {
          ...state.healthStatus,
          [server.id]: server.lastHealthStatus ?? 'unknown',
        },
      }
    })
  },

  removeServer: (id) => {
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      tools: state.tools.filter((t) => t.serverId !== id),
      healthStatus: Object.fromEntries(
        Object.entries(state.healthStatus).filter(([key]) => key !== id)
      ),
    }))
  },

  setError: (message) => {
    set({ error: message })
  },
}))

// Selector hooks for common use cases
export const useEnabledMcpServers = () =>
  useMcpServerStore((state) =>
    state.servers.filter((s) => s.enabled)
  )

export const useHealthyMcpServers = () =>
  useMcpServerStore((state) =>
    state.servers.filter(
      (s) => s.enabled && state.healthStatus[s.id] === 'healthy'
    )
  )

export const useMcpToolsByServer = (serverId: string) =>
  useMcpServerStore((state) =>
    state.tools.filter((t) => t.serverId === serverId)
  )

export const useEnabledMcpTools = () =>
  useMcpServerStore((state) => {
    const enabledServerIds = new Set(
      state.servers.filter((s) => s.enabled).map((s) => s.id)
    )
    return state.tools.filter((t) => enabledServerIds.has(t.serverId))
  })

export const resetMcpServerStoreState = () => {
  useMcpServerStore.setState({ ...createInitialState() })
}
