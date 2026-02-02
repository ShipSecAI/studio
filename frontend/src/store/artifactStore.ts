import { create } from 'zustand';
import type { ArtifactMetadata } from '@shipsec/shared';
import { api, type ArtifactListFilters } from '@/services/api';

interface RunArtifactEntry {
  artifacts: ArtifactMetadata[];
  loading: boolean;
  error: string | null;
  lastFetched?: number;
}

interface ArtifactStoreState {
  runArtifacts: Record<string, RunArtifactEntry | undefined>;
  library: ArtifactMetadata[];
  libraryLoading: boolean;
  libraryError: string | null;
  libraryFilters?: ArtifactListFilters;
  downloading: Record<string, boolean>;
  deleting: Record<string, boolean>;
  fetchRunArtifacts: (runId: string, force?: boolean) => Promise<void>;
  fetchLibrary: (filters?: ArtifactListFilters) => Promise<void>;
  downloadArtifact: (artifact: ArtifactMetadata, options?: { runId?: string }) => Promise<void>;
  deleteArtifact: (artifactId: string) => Promise<void>;
}

export const useArtifactStore = create<ArtifactStoreState>((set, get) => ({
  runArtifacts: {},
  library: [],
  libraryLoading: false,
  libraryError: null,
  downloading: {},
  deleting: {},
  async fetchRunArtifacts(runId: string, force = false) {
    const existing = get().runArtifacts[runId];
    if (!force && existing && !existing.error && existing.artifacts.length > 0) {
      return;
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
    }));

    try {
      const response = await api.executions.getArtifacts(runId);
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
      }));
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
      }));
    }
  },
  async fetchLibrary(filters) {
    set({ libraryLoading: true, libraryError: null, libraryFilters: filters });
    try {
      const response = await api.artifacts.list(filters);
      set({
        library: response.artifacts ?? [],
        libraryLoading: false,
        libraryError: null,
      });
    } catch (error) {
      set({
        libraryLoading: false,
        libraryError: error instanceof Error ? error.message : 'Failed to load artifacts',
      });
    }
  },
  async downloadArtifact(artifact, options) {
    set((state) => ({
      downloading: { ...state.downloading, [artifact.id]: true },
    }));
    try {
      const blob = options?.runId
        ? await api.executions.downloadArtifact(options.runId, artifact.id)
        : await api.artifacts.download(artifact.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = artifact.name || `artifact-${artifact.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download artifact', error);
      throw error;
    } finally {
      set((state) => {
        const { [artifact.id]: _removed, ...next } = state.downloading;
        return { downloading: next };
      });
    }
  },
  async deleteArtifact(artifactId: string) {
    set((state) => ({
      deleting: { ...state.deleting, [artifactId]: true },
    }));
    try {
      await api.artifacts.delete(artifactId);
      // Remove artifact from library after successful deletion
      set((state) => ({
        library: state.library.filter((a) => a.id !== artifactId),
      }));
    } catch (error) {
      console.error('Failed to delete artifact', error);
      throw error;
    } finally {
      set((state) => {
        const { [artifactId]: _removed, ...next } = state.deleting;
        return { deleting: next };
      });
    }
  },
}));
