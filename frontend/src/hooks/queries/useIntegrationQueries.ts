import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import type { components } from '@shipsec/backend-client';

type IntegrationProvider = components['schemas']['IntegrationProviderResponse'];
type IntegrationConnection = components['schemas']['IntegrationConnectionResponse'];

function sortProviders(providers: IntegrationProvider[]) {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

function sortConnections(connections: IntegrationConnection[]) {
  return [...connections].sort((a, b) => a.providerName.localeCompare(b.providerName));
}

export function useIntegrationProviders() {
  return useQuery({
    queryKey: queryKeys.integrations.providers(),
    queryFn: () => api.integrations.listProviders(),
    staleTime: Infinity,
    gcTime: Infinity,
    select: sortProviders,
  });
}

export function useIntegrationConnections(_userId?: string | undefined) {
  return useQuery({
    queryKey: queryKeys.integrations.connections(),
    queryFn: () => api.integrations.listOrgConnections(),
    staleTime: 60_000,
    select: sortConnections,
  });
}

export function useIntegrationCatalog() {
  return useQuery({
    queryKey: ['integrationCatalog'],
    queryFn: () => api.integrations.getCatalog(),
    staleTime: Infinity,
  });
}

export function useAwsSetupInfo() {
  return useQuery({
    queryKey: ['awsSetupInfo'],
    queryFn: () => api.integrations.getAwsSetupInfo(),
    staleTime: 25 * 60_000, // matches backend TTL
  });
}

export function useProviderConfig(providerId: string | undefined, enabled = true) {
  const isEnabled = !!providerId && enabled;
  return useQuery({
    queryKey: queryKeys.integrations.providerConfig(providerId || ''),
    queryFn: isEnabled ? () => api.integrations.getProviderConfig(providerId!) : skipToken,
    enabled: isEnabled,
    staleTime: 30_000,
    ...(isEnabled ? {} : { gcTime: 0 }),
  });
}

export function useRefreshConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.refreshConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.disconnect(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useCreateAwsConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      displayName: string;
      roleArn: string;
      region?: string;
      externalId: string;
      setupToken: string;
    }) => api.integrations.createAwsConnection(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
      qc.removeQueries({ queryKey: ['awsSetupInfo'] }); // clear so next connection gets fresh setup token
    },
  });
}

export function useCreateSlackWebhookConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { displayName: string; webhookUrl: string }) =>
      api.integrations.createSlackWebhookConnection(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useValidateAwsConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.validateAwsConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useTestSlackConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.testSlackConnection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useDiscoverOrgAccounts() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.discoverOrgAccounts(id),
  });
}
