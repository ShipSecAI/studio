import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  SecretSummary,
  CreateSecretInput,
  UpdateSecretInput,
  RotateSecretInput,
} from '@/schemas/secret';

export function useSecrets() {
  return useQuery({
    queryKey: queryKeys.secrets.all(),
    queryFn: () => api.secrets.list(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    select: (data: SecretSummary[]) => [...data].sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export function useCreateSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSecretInput) => api.secrets.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
    },
  });
}

export function useUpdateSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSecretInput }) =>
      api.secrets.update(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
    },
  });
}

export function useRotateSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RotateSecretInput }) =>
      api.secrets.rotate(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
    },
  });
}

export function useDeleteSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.secrets.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.secrets.all() });
    },
  });
}
