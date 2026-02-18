import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { WebhookConfiguration } from '@shipsec/shared';
import { api } from '@/services/api';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.webhooks.all(),
    queryFn: () => api.webhooks.list(),
    staleTime: 60_000,
  });
}

export function useWebhook(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.webhooks.detail(id || ''),
    queryFn: () => api.webhooks.get(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useWebhookDeliveries(webhookId: string | undefined) {
  return useQuery({
    queryKey: ['webhookDeliveries', webhookId] as const,
    queryFn: () => api.webhooks.listDeliveries(webhookId!),
    enabled: !!webhookId,
    staleTime: 60_000,
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.webhooks.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<WebhookConfiguration>) => api.webhooks.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<WebhookConfiguration> }) =>
      api.webhooks.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useRegenerateWebhookPath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const headers = await getApiAuthHeaders();
      const response = await fetch(`${API_V1_URL}/webhooks/configurations/${id}/regenerate-path`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to regenerate webhook path');
      return response.json() as Promise<{ id: string; webhookPath: string; url: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useTestWebhookScript() {
  return useMutation({
    mutationFn: (dto: {
      parsingScript: string;
      testPayload: Record<string, unknown>;
      testHeaders?: Record<string, string>;
      webhookId?: string;
    }) =>
      api.webhooks.testScript({
        script: dto.parsingScript,
        payload: dto.testPayload,
        headers: dto.testHeaders ?? {},
      }),
  });
}
