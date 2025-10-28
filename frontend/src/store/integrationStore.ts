import { create } from 'zustand'
import { api } from '@/services/api'
import type {
  IntegrationConnection,
  IntegrationProvider,
} from '@/schemas/integration'

interface IntegrationStoreState {
  providers: IntegrationProvider[]
  connections: IntegrationConnection[]
  loadingProviders: boolean
  loadingConnections: boolean
  error: string | null
  initialized: boolean
}

interface IntegrationStoreActions {
  fetchProviders: () => Promise<void>
  fetchConnections: (userId: string, force?: boolean) => Promise<void>
  refreshConnection: (id: string, userId: string) => Promise<IntegrationConnection>
  disconnect: (id: string, userId: string) => Promise<void>
  upsertConnection: (connection: IntegrationConnection) => void
  resetError: () => void
}

type IntegrationStore = IntegrationStoreState & IntegrationStoreActions

function sortProviders(providers: IntegrationProvider[]) {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name))
}

function sortConnections(connections: IntegrationConnection[]) {
  return [...connections].sort((a, b) => a.providerName.localeCompare(b.providerName))
}

export const useIntegrationStore = create<IntegrationStore>((set, get) => ({
  providers: [],
  connections: [],
  loadingProviders: false,
  loadingConnections: false,
  error: null,
  initialized: false,

  fetchProviders: async () => {
    if (get().loadingProviders) {
      return
    }

    set({ loadingProviders: true, error: null })
    try {
      const providers = await api.integrations.listProviders()
      set({
        providers: sortProviders(providers),
        loadingProviders: false,
      })
    } catch (error) {
      set({
        loadingProviders: false,
        error: error instanceof Error ? error.message : 'Failed to load providers',
      })
    }
  },

  fetchConnections: async (userId: string, force = false) => {
    const { loadingConnections, initialized } = get()
    if (loadingConnections || (!force && initialized)) {
      return
    }

    set({ loadingConnections: true, error: null })
    try {
      const connections = await api.integrations.listConnections(userId)
      set({
        connections: sortConnections(connections),
        loadingConnections: false,
        initialized: true,
      })
    } catch (error) {
      set({
        loadingConnections: false,
        error: error instanceof Error ? error.message : 'Failed to load integrations',
      })
    }
  },

  upsertConnection: (connection: IntegrationConnection) => {
    set((state) => ({
      connections: sortConnections(
        state.connections.some((item) => item.id === connection.id)
          ? state.connections.map((item) => (item.id === connection.id ? connection : item))
          : [...state.connections, connection],
      ),
    }))
  },

  refreshConnection: async (id: string, userId: string) => {
    try {
      const refreshed = await api.integrations.refreshConnection(id, userId)
      set((state) => ({
        connections: sortConnections(
          state.connections.map((connection) => (connection.id === id ? refreshed : connection)),
        ),
      }))
      return refreshed
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to refresh integration token'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  disconnect: async (id: string, userId: string) => {
    try {
      await api.integrations.disconnect(id, userId)
      set((state) => ({
        connections: state.connections.filter((connection) => connection.id !== id),
      }))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to disconnect integration'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  resetError: () => {
    set({ error: null })
  },
}))
