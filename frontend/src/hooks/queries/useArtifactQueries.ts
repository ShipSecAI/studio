import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ArtifactMetadata } from '@shipsec/shared';
import { api, type ArtifactListFilters } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { terminalStaleTime } from '@/hooks/queries/useRunQueries';

export function useRunArtifacts(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifacts.byRun(runId!),
    queryFn: async () => {
      const response = await api.executions.getArtifacts(runId!);
      return response.artifacts ?? [];
    },
    enabled: !!runId,
    staleTime: terminalStaleTime(runId ?? null, 30_000),
  });
}

export function useArtifactLibrary(filters?: ArtifactListFilters) {
  return useQuery({
    queryKey: queryKeys.artifacts.library(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await api.artifacts.list(filters);
      return (response.artifacts ?? []) as ArtifactMetadata[];
    },
    staleTime: 30_000,
  });
}

export function useDownloadArtifact() {
  return useMutation({
    mutationFn: async ({ artifact, runId }: { artifact: ArtifactMetadata; runId?: string }) => {
      const blob = runId
        ? await api.executions.downloadArtifact(runId, artifact.id)
        : await api.artifacts.download(artifact.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = artifact.name || `artifact-${artifact.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    },
  });
}

export function useDeleteArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) => api.artifacts.delete(artifactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artifactLibrary'] });
    },
  });
}
