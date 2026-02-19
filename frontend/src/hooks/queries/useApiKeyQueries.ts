import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { components } from '@shipsec/backend-client';
import { create } from 'zustand';

type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];
type CreateApiKeyDto = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyDto = components['schemas']['UpdateApiKeyDto'];

// Tiny Zustand store just for the ephemeral lastCreatedKey (client-only state)
interface ApiKeyUiState {
  lastCreatedKey: string | null;
  setLastCreatedKey: (key: string | null) => void;
  clearLastCreatedKey: () => void;
}

export const useApiKeyUiStore = create<ApiKeyUiState>((set) => ({
  lastCreatedKey: null,
  setLastCreatedKey: (key) => set({ lastCreatedKey: key }),
  clearLastCreatedKey: () => set({ lastCreatedKey: null }),
}));

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys.all(),
    queryFn: () => api.apiKeys.list(),
    staleTime: 60_000,
    select: (data: ApiKeyResponseDto[]) =>
      [...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyDto) => api.apiKeys.create(input),
    onSuccess: (created) => {
      useApiKeyUiStore.getState().setLastCreatedKey(created.plainKey || null);
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys.all() });
    },
  });
}

export function useUpdateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateApiKeyDto }) =>
      api.apiKeys.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys.all() });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiKeys.revoke(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys.all() });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.apiKeys.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys.all() });
    },
  });
}
