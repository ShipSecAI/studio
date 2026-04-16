import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { API_V1_URL, api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { getFreshClerkToken } from '@/utils/clerk-token';
import type { components } from '@shipsec/backend-client';

type IntegrationProvider = components['schemas']['IntegrationProviderResponse'];
type IntegrationConnection = components['schemas']['IntegrationConnectionResponse'];
interface ValidateGcpResponse {
  valid: boolean;
  serviceAccountEmail?: string;
  serviceAccountUniqueId?: string;
  defaultProjectId?: string;
  organizationId?: string;
  projects?: {
    id: string;
    displayName: string;
    type: 'project' | 'folder' | 'organization';
    parent?: string;
    state?: string;
  }[];
  error?: string;
}
interface DiscoverGcpProjectsResponse {
  resources: {
    id: string;
    displayName: string;
    type: 'project' | 'folder' | 'organization';
    parent?: string;
    state?: string;
  }[];
}
interface GcpSetupInfoResponse {
  serviceAccountEmail: string;
  serviceAccountMember: string;
  sourceProjectId?: string;
  tokenCreatorRole: 'roles/iam.serviceAccountTokenCreator';
}

function sortProviders(providers: IntegrationProvider[]) {
  return [...providers].sort((a, b) => a.name.localeCompare(b.name));
}

function sortConnections(connections: IntegrationConnection[]) {
  return [...connections].sort((a, b) => a.providerName.localeCompare(b.providerName));
}

async function getIntegrationRequestHeaders(): Promise<Record<string, string>> {
  const storeState = useAuthStore.getState();
  let token = storeState.token;
  const organizationId = storeState.provider === 'local' ? 'local-dev' : storeState.organizationId;

  if (storeState.provider === 'clerk') {
    try {
      const freshToken = await getFreshClerkToken();
      if (freshToken) {
        token = freshToken;
        storeState.setToken(freshToken);
      }
    } catch {
      // fall back to the currently cached token
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
    const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`);
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (token && token.trim().length > 0) {
    headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  if (organizationId && organizationId.trim().length > 0) {
    headers['X-Organization-Id'] = organizationId;
  }

  return headers;
}

async function postIntegrationJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'POST',
    headers: await getIntegrationRequestHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

async function getIntegrationJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_V1_URL}${path}`, {
    method: 'GET',
    headers: await getIntegrationRequestHeaders(),
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
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

export function useAwsSetupInfo() {
  return useQuery({
    queryKey: queryKeys.integrations.awsSetupInfo(),
    queryFn: () => api.integrations.getAwsSetupInfo(),
    staleTime: 25 * 60_000,
  });
}

export function useGcpSetupInfo() {
  return useQuery({
    queryKey: queryKeys.integrations.gcpSetupInfo(),
    queryFn: () => getIntegrationJson<GcpSetupInfoResponse>('/integrations/gcp/setup-info'),
    staleTime: 25 * 60_000,
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

export function useCreateGcpConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      displayName: string;
      targetServiceAccountEmail: string;
      defaultProjectId?: string;
      organizationId?: string;
    }) => postIntegrationJson<IntegrationConnection>('/integrations/gcp/connections', payload),
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
    mutationFn: ({ id }: { id: string }) =>
      postIntegrationJson<ValidateGcpResponse>(`/integrations/gcp/connections/${id}/validate`),
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
    mutationFn: ({ id }: { id: string }) =>
      postIntegrationJson<DiscoverGcpProjectsResponse>(
        `/integrations/gcp/connections/${id}/discover-projects`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}

export function useConnectJiraSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteHostname: string) => api.integrations.connectJiraSite(siteHostname),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.integrations.connections() });
    },
  });
}
