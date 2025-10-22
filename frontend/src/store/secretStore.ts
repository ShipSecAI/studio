import { create } from 'zustand'
import { api } from '@/services/api'
import type { SecretSummary, CreateSecretInput, UpdateSecretInput, RotateSecretInput } from '@/schemas/secret'

interface SecretStoreState {
  secrets: SecretSummary[]
  loading: boolean
  error: string | null
  initialized: boolean
}

interface SecretStoreActions {
  fetchSecrets: (force?: boolean) => Promise<void>
  createSecret: (input: CreateSecretInput) => Promise<SecretSummary>
  rotateSecret: (id: string, input: RotateSecretInput) => Promise<SecretSummary>
  updateSecret: (id: string, input: UpdateSecretInput) => Promise<SecretSummary>
  deleteSecret: (id: string) => Promise<void>
  getSecretById: (id: string) => SecretSummary | undefined
  refresh: () => Promise<void>
}

type SecretStore = SecretStoreState & SecretStoreActions

function sortSecrets(secrets: SecretSummary[]) {
  return [...secrets].sort((a, b) => a.name.localeCompare(b.name))
}

export const useSecretStore = create<SecretStore>((set, get) => ({
  secrets: [],
  loading: false,
  error: null,
  initialized: false,

  fetchSecrets: async (force = false) => {
    const { loading, initialized } = get()
    if (loading || (!force && initialized)) {
      return
    }

    set({ loading: true, error: null })
    try {
      const secrets = await api.secrets.list()
      set({
        secrets: sortSecrets(secrets),
        loading: false,
        error: null,
        initialized: true,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load secrets',
        loading: false,
      })
    }
  },

  createSecret: async (input: CreateSecretInput) => {
    set({ loading: true, error: null })
    try {
      const created = await api.secrets.create(input)
      set((state) => ({
        secrets: sortSecrets([...state.secrets, created]),
        loading: false,
        error: null,
        initialized: true,
      }))
      return created
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create secret'
      set({ error: message, loading: false })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  updateSecret: async (id: string, input: UpdateSecretInput) => {
    set({ error: null })
    try {
      const updated = await api.secrets.update(id, input)
      set((state) => ({
        secrets: sortSecrets(
          state.secrets.map((secret) => (secret.id === id ? updated : secret))
        ),
        error: null,
        initialized: true,
      }))
      return updated
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update secret'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  rotateSecret: async (id: string, input: RotateSecretInput) => {
    set({ error: null })
    try {
      const rotated = await api.secrets.rotate(id, input)
      set((state) => ({
        secrets: sortSecrets(
          state.secrets.map((secret) => (secret.id === id ? rotated : secret))
        ),
        error: null,
        initialized: true,
      }))
      return rotated
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate secret'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  deleteSecret: async (id: string) => {
    set({ error: null })
    try {
      await api.secrets.delete(id)
      set((state) => ({
        secrets: state.secrets.filter((secret) => secret.id !== id),
        error: null,
        initialized: true,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete secret'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  },

  getSecretById: (id: string) => {
    return get().secrets.find((secret) => secret.id === id)
  },

  refresh: async () => {
    await get().fetchSecrets(true)
  },
}))
