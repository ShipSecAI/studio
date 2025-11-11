import { create } from 'zustand'
import type { ArtifactMetadata } from '@shipsec/shared'
import { api, type ArtifactListFilters } from '@/services/api'

type RunArtifactEntry = {
  artifacts: ArtifactMetadata[]
  loading: boolean
  error: string | null
  lastFetched?: number
}

interface ArtifactStoreState {
  runArtifacts: Record<string, RunArtifactEntry | undefined>
  library: ArtifactMetadata[]
  libraryLoading: boolean
  libraryError: string | null
  libraryFilters?: ArtifactListFilters
  downloading: Record<string, boolean>
  fetchRunArtifacts: (runId: string, force?: boolean) => Promise<void>
  fetchLibrary: (filters?: ArtifactListFilters) => Promise<void>
  downloadArtifact: (artifact: ArtifactMetadata) => Promise<void>
}

export const useArtifactStore = create<ArtifactStoreState>((set, get) => ({
  runArtifacts: {},
  library: [],
  libraryLoading: false,
  libraryError: null,
  downloading: {},
  async fetchRunArtifacts(runId: string, force = false) {
    const existing = get().runArtifacts[runId]
    if (!force && existing && !existing.error && existing.artifacts.length > 0) {
      return
    }

    set((state) => ({
      runArtifacts: {
        ...state.runArtifacts,
        [runId]: {
          artifacts: existing?.artifacts ?? [],
          loading: true,
          error: null,
        },
      },
    }))

    try {
      const response = await api.executions.getArtifacts(runId)
      set((state) => ({
        runArtifacts: {
          ...state.runArtifacts,
          [runId]: {
            artifacts: response.artifacts ?? [],
            loading: false,
            error: null,
            lastFetched: Date.now(),
          },
        },
      }))
    } catch (error) {
      set((state) => ({
        runArtifacts: {
          ...state.runArtifacts,
          [runId]: {
            artifacts: existing?.artifacts ?? [],
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load artifacts',
            lastFetched: existing?.lastFetched,
          },
        },
      }))
    }
  },
  async fetchLibrary(filters) {
    set({ libraryLoading: true, libraryError: null, libraryFilters: filters })
    try {
      const response = await api.artifacts.list(filters)
      set({
        library: response.artifacts ?? [],
        libraryLoading: false,
        libraryError: null,
      })
    } catch (error) {
      set({
        libraryLoading: false,
        libraryError: error instanceof Error ? error.message : 'Failed to load artifacts',
      })
    }
  },
  async downloadArtifact(artifact) {
    set((state) => ({
      downloading: { ...state.downloading, [artifact.id]: true },
    }))
    try {
      const blob = await api.artifacts.download(artifact.id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = artifact.name || `artifact-${artifact.id}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download artifact', error)
      throw error
    } finally {
      set((state) => {
        const next = { ...state.downloading }
        delete next[artifact.id]
        return { downloading: next }
      })
    }
  },
}))
