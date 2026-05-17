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
    queryKey: queryKeys.integrations.catalog(),
    queryFn: () => api.integrations.getCatalog(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useAwsSetupInfo(enabled = true) {
  const isEnabled = enabled;
  return useQuery({
    queryKey: queryKeys.integrations.awsSetupInfo(),
    queryFn: isEnabled ? () => api.integrations.getAwsSetupInfo() : skipToken,
    enabled: isEnabled,
    staleTime: 25 * 60_000,
    ...(isEnabled ? {} : { gcTime: 0 }),
  });
}

export function useGcpSetupInfo(enabled = true) {
  const isEnabled = enabled;
  return useQuery({
    queryKey: queryKeys.integrations.gcpSetupInfo(),
    queryFn: isEnabled ? () => api.integrations.getGcpSetupInfo() : skipToken,
    enabled: isEnabled,
    staleTime: 25 * 60_000,
    ...(isEnabled ? {} : { gcTime: 0 }),
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
      qc.removeQueries({ queryKey: queryKeys.integrations.awsSetupInfo() });
    },
  });
}

export function useCreateAwsAccessKeyConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      displayName: string;
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      region?: string;
    }) => api.integrations.createAwsAccessKeyConnection(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useCreateGcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      displayName: string;
      targetServiceAccountEmail: string;
      defaultProjectId?: string;
      organizationId?: string;
    }) => api.integrations.createGcpConnection(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useCreateGcpServiceAccountKeyConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      displayName: string;
      serviceAccountJson: string;
      defaultProjectId?: string;
      organizationId?: string;
    }) => api.integrations.createGcpServiceAccountKeyConnection(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
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

export function useCreateJiraForgeConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { displayName: string; webTriggerUrl: string; sharedSecret?: string }) =>
      api.integrations.createJiraForgeConnection(payload),
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

export function useValidateGcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.validateGcpConnection(id),
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

export function useDiscoverGcpProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.integrations.discoverGcpProjects(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}
