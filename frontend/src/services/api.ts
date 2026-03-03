import { createShipSecClient, type components } from '@shipsec/backend-client';
import type {
  ArtifactDestination,
  RunArtifactsResponse,
  WorkflowSchedule,
  ScheduleStatus,
  WebhookConfiguration,
  WebhookDelivery,
  TestWebhookScriptResponse,
} from '@shipsec/shared';
import { useAuthStore } from '@/store/authStore';
import { getFreshClerkToken } from '@/utils/clerk-token';
// Direct type imports from backend client
type WorkflowResponseDto = components['schemas']['WorkflowResponseDto'];
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto'];
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto'];
type SecretSummaryResponse = components['schemas']['SecretSummaryResponse'];
type SecretValueResponse = components['schemas']['SecretValueResponse'];
type CreateSecretDto = components['schemas']['CreateSecretDto'];
type RotateSecretDto = components['schemas']['RotateSecretDto'];
type UpdateSecretDto = components['schemas']['UpdateSecretDto'];
type IntegrationProviderResponse = components['schemas']['IntegrationProviderResponse'];
type IntegrationConnectionResponse = components['schemas']['IntegrationConnectionResponse'];
type ProviderConfigurationResponse = components['schemas']['ProviderConfigurationResponse'];
type OAuthStartResponseDto = components['schemas']['OAuthStartResponseDto'];
type UpsertProviderConfigRequest = components['schemas']['UpsertProviderConfigDto'];
type WorkflowVersionResponse = components['schemas']['WorkflowVersionResponseDto'];
type CreateScheduleRequestDto = components['schemas']['CreateScheduleRequestDto'];
type UpdateScheduleRequestDto = components['schemas']['UpdateScheduleRequestDto'];
type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto'];
type CreateApiKeyResponseDto = components['schemas']['CreateApiKeyResponseDto'];
type CreateApiKeyDto = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyDto = components['schemas']['UpdateApiKeyDto'];
// TODO: regenerate OpenAPI types to pull from schema
export interface ProwlerCheckMetadata {
  checkTitle: string | null;
  recommendation: string | null;
  recommendationUrl: string | null;
  cli: string | null;
  nativeIaC: string | null;
  terraform: string | null;
  other: string | null;
}

export interface ListAuditLogsResponseDto {
  items: {
    id: string;
    organizationId: string | null;
    actorId: string | null;
    actorType: 'user' | 'api-key' | 'internal' | 'unknown';
    actorDisplay: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    resourceName: string | null;
    metadata: Record<string, unknown> | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
}

export interface TerminalChunkResponse {
  runId: string;
  cursor?: string;
  chunks: {
    nodeRef: string;
    stream: string;
    chunkIndex: number;
    payload: string;
    recordedAt: string;
    deltaMs?: number;
    origin?: string;
    runnerKind?: string;
  }[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  iconColor: string | null;
  organizationId: string | null;
  isSystem: boolean;
  templateId: string | null;
  lastRun: string | null;
  latestRunStatus: string | null;
  runCount: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export type IntegrationProvider = IntegrationProviderResponse;
export type IntegrationConnection = IntegrationConnectionResponse;
export type IntegrationProviderConfiguration = ProviderConfigurationResponse;
export type OAuthStartResponse = OAuthStartResponseDto;

// Catalog types (from backend integration-catalog.ts)
export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  iconUrl?: string;
  authMethods: {
    type: string;
    label: string;
    description: string;
    fields: {
      id: string;
      label: string;
      type: 'text' | 'password' | 'select';
      required: boolean;
      placeholder?: string;
      helpText?: string;
      options?: { label: string; value: string }[];
    }[];
  }[];
  supportsMultipleConnections: boolean;
  setupInstructions: {
    sections: {
      title: string;
      authMethodType: string;
      scenario: string;
      steps: string[];
    }[];
  };
}
export interface ArtifactListFilters {
  workflowId?: string;
  componentId?: string;
  destination?: ArtifactDestination;
  search?: string;
  limit?: number;
}

/**
 * API Client Configuration
 */
type RuntimeImportMeta = ImportMeta & {
  env?: Record<string, string | undefined>;
};

function resolveApiBaseUrl() {
  const metaEnv = (import.meta as RuntimeImportMeta).env;
  if (metaEnv?.VITE_API_URL && metaEnv.VITE_API_URL.trim().length > 0) {
    const configured = metaEnv.VITE_API_URL.trim();
    return configured.replace(/\/api(?:\/v1)?\/?$/i, '');
  }

  if (typeof process !== 'undefined') {
    const nodeEnv = (process.env ?? {}).VITE_API_URL;
    if (nodeEnv && nodeEnv.trim().length > 0) {
      return nodeEnv.trim().replace(/\/api(?:\/v1)?\/?$/i, '');
    }
  }

  // No explicit API URL — use same-origin relative paths.
  // Works with path-based routing (/api/v1/* routed to backend via Ingress).
  // For local dev, set VITE_API_URL=http://localhost:3211 in frontend/.env
  return '';
}

export const API_BASE_URL = resolveApiBaseUrl();
export const API_V1_URL = `${API_BASE_URL}/api/v1`;

// Helper function to get auth headers (reused by middleware and file operations)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const storeState = useAuthStore.getState();
  let token = storeState.token;
  // For local auth, always use 'local-dev' org ID
  const organizationId = storeState.provider === 'local' ? 'local-dev' : storeState.organizationId;

  // For Clerk auth, always fetch a fresh token on-demand to prevent expiration issues
  // This ensures we never use a stale/expired token
  if (storeState.provider === 'clerk') {
    try {
      const freshToken = await getFreshClerkToken();
      if (freshToken) {
        token = freshToken;
        // Update store with fresh token so it's available for next time
        storeState.setToken(freshToken);
      } else {
        // If we can't get a fresh token, fall back to store token
      }
    } catch (_error) {
      // Fall back to store token if fresh token fetch fails
    }
  }

  const headers: Record<string, string> = {};

  // For local auth with admin credentials, use Basic Auth
  if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
    const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`);
    headers['Authorization'] = `Basic ${credentials}`;
  } else if (token && token.trim().length > 0) {
    // Use Bearer token (for Clerk)
    const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    headers['Authorization'] = headerValue;
  }

  if (organizationId && organizationId.trim().length > 0) {
    headers['X-Organization-Id'] = organizationId;
  }

  return headers;
}

// Create type-safe API client
const apiClient = createShipSecClient({
  baseUrl: API_BASE_URL,
  middleware: {
    async onRequest({ request }) {
      const headers = await getAuthHeaders();

      // Apply auth headers to the request
      if (headers['Authorization']) {
        request.headers.set('Authorization', headers['Authorization']);
      }
      if (headers['X-Organization-Id']) {
        request.headers.set('X-Organization-Id', headers['X-Organization-Id']);
      }

      if (!request.headers.has('Content-Type')) {
        request.headers.set('Content-Type', 'application/json');
      }

      return request;
    },
  },
});

async function fetchScheduleById(id: string): Promise<WorkflowSchedule> {
  const response = await apiClient.getSchedule(id);
  if (response.error) {
    throw new Error('Failed to fetch schedule');
  }
  const schedule = (response.data ?? null) as WorkflowSchedule | null;
  if (!schedule) {
    throw new Error('Schedule not found');
  }
  return schedule;
}

/**
 * API Service
 * Simple wrapper around the backend API client
 */
export const api = {
  workflows: {
    list: async (): Promise<WorkflowResponseDto[]> => {
      const response = await apiClient.listWorkflows();
      if (response.error) throw new Error('Failed to fetch workflows');
      return response.data || [];
    },

    listSummary: async (): Promise<WorkflowSummary[]> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/workflows/summary`, { headers });
      if (!response.ok) throw new Error('Failed to fetch workflow summaries');
      return response.json();
    },

    get: async (id: string): Promise<WorkflowResponseDto> => {
      const response = await apiClient.getWorkflow(id);
      if (response.error) throw new Error('Failed to fetch workflow');
      if (!response.data) throw new Error('Workflow not found');
      return response.data;
    },

    getVersion: async (workflowId: string, versionId: string): Promise<WorkflowVersionResponse> => {
      const response = await apiClient.getWorkflowVersion(workflowId, versionId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch workflow version');
      }
      return response.data;
    },

    getRuntimeInputs: async (workflowId: string) => {
      const response = await apiClient.getWorkflowRuntimeInputs(workflowId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch workflow runtime inputs');
      }
      return response.data;
    },

    create: async (workflow: CreateWorkflowRequestDto): Promise<WorkflowResponseDto> => {
      const response = (await apiClient.createWorkflow(workflow)) as any;
      if (response.error) {
        const errorMessage =
          response.error?.message ||
          (typeof response.error === 'string' ? response.error : 'Failed to create workflow');
        throw new Error(errorMessage);
      }
      if (!response.data) throw new Error('Workflow creation failed');
      return response.data;
    },

    update: async (
      id: string,
      workflow: UpdateWorkflowRequestDto,
    ): Promise<WorkflowResponseDto> => {
      const response = (await apiClient.updateWorkflow(id, workflow)) as any;
      if (response.error) {
        const errorMessage =
          response.error?.message ||
          (typeof response.error === 'string' ? response.error : 'Failed to update workflow');
        throw new Error(errorMessage);
      }
      if (!response.data) throw new Error('Workflow update failed');
      return response.data;
    },

    updateMetadata: async (
      id: string,
      metadata: {
        name: string;
        description?: string | null;
        icon?: string | null;
        iconColor?: string | null;
      },
    ): Promise<WorkflowResponseDto> => {
      const response = await apiClient.updateWorkflowMetadata(id, metadata);
      if (response.error) throw new Error('Failed to update workflow metadata');
      if (!response.data) throw new Error('Workflow update failed');
      return response.data;
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteWorkflow(id);
      if (response.error) throw new Error('Failed to delete workflow');
    },

    commit: async (id: string) => {
      const response: any = await apiClient.commitWorkflow(id);
      if (response.error) {
        const message = response.error?.message || 'Failed to commit workflow';
        throw new Error(message);
      }
      return response.data;
    },

    run: async (id: string, body?: { inputs?: Record<string, unknown> }) => {
      const response: any = await apiClient.runWorkflow(id, body);
      if (response.error) {
        const message = response.error?.message || 'Failed to run workflow';
        throw new Error(message);
      }
      return response.data;
    },
  },

  components: {
    list: async () => {
      const response = await apiClient.listComponents();
      if (response.error) throw new Error('Failed to fetch components');
      return response.data || [];
    },

    get: async (slug: string) => {
      const response = await apiClient.getComponent(slug);
      if (response.error) throw new Error('Failed to fetch component');
      return response.data;
    },

    resolvePorts: async (id: string, params: Record<string, unknown>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/components/${id}/resolve-ports`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error('Failed to resolve ports');
      }
      return await response.json();
    },
  },

  secrets: {
    list: async (): Promise<SecretSummaryResponse[]> => {
      const response = await apiClient.listSecrets();
      if (response.error) throw new Error('Failed to fetch secrets');
      return response.data || [];
    },

    create: async (input: CreateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.createSecret(input);
      if (response.error) throw new Error('Failed to create secret');
      if (!response.data) throw new Error('Secret creation failed');
      return response.data;
    },

    update: async (id: string, input: UpdateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.updateSecret(id, input);
      if (response.error) throw new Error('Failed to update secret');
      if (!response.data) throw new Error('Secret update failed');
      return response.data;
    },

    rotate: async (id: string, input: RotateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.rotateSecret(id, input);
      if (response.error) throw new Error('Failed to rotate secret');
      if (!response.data) throw new Error('Secret rotation failed');
      return response.data;
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteSecret(id);
      if (response.error) throw new Error('Failed to delete secret');
    },

    getValue: async (id: string, version?: number): Promise<SecretValueResponse> => {
      const response = await apiClient.getSecretValue(id, version);
      if (response.error) throw new Error('Failed to fetch secret value');
      if (!response.data) throw new Error('Secret value not found');
      return response.data;
    },
  },

  integrations: {
    listProviders: async (): Promise<IntegrationProvider[]> => {
      const response = await apiClient.listIntegrationProviders();
      if (response.error) throw new Error('Failed to load providers');
      return (response.data ?? []) as IntegrationProvider[];
    },

    // D6: org-scoped connection listing (primary source of truth)
    listOrgConnections: async (provider?: string): Promise<IntegrationConnection[]> => {
      const headers = await getAuthHeaders();
      const params = provider ? `?provider=${encodeURIComponent(provider)}` : '';
      const res = await fetch(`${API_V1_URL}/integrations/org/connections${params}`, { headers });
      if (!res.ok) throw new Error('Failed to load org connections');
      return res.json();
    },

    // D5: Provider catalog (AWS + Slack definitions)
    getCatalog: async (): Promise<IntegrationCatalogEntry[]> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_URL}/integrations/catalog`, { headers });
      if (!res.ok) throw new Error('Failed to load integration catalog');
      return res.json();
    },

    // D16: userId removed from OAuth payloads
    startOAuth: async (
      providerId: string,
      payload: { redirectUri: string; scopes?: string[] },
    ): Promise<OAuthStartResponse> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/${encodeURIComponent(providerId)}/start`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error('Failed to start OAuth flow');
      return res.json();
    },

    completeOAuth: async (
      providerId: string,
      payload: { redirectUri: string; state: string; code: string; scopes?: string[] },
    ): Promise<IntegrationConnection> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/${encodeURIComponent(providerId)}/exchange`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error('Failed to complete OAuth exchange');
      return res.json();
    },

    // D16: userId removed, derived from auth context
    refreshConnection: async (id: string): Promise<IntegrationConnection> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/connections/${encodeURIComponent(id)}/refresh`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) throw new Error('Failed to refresh integration connection');
      return res.json();
    },

    // D16: userId removed, derived from auth context
    disconnect: async (id: string): Promise<void> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_URL}/integrations/connections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to disconnect integration');
    },

    // AWS setup info (generates trust policy + external ID + setup token)
    getAwsSetupInfo: async (): Promise<{
      platformRoleArn: string;
      externalId: string;
      setupToken: string;
      trustPolicyTemplate: string;
      externalIdDisplay?: string;
    }> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_URL}/integrations/aws/setup-info`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to load AWS setup info');
      }
      return res.json();
    },

    // AWS connection management (IAM role only)
    createAwsConnection: async (payload: {
      displayName: string;
      roleArn: string;
      region?: string;
      externalId: string;
      setupToken: string;
    }): Promise<IntegrationConnection> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_URL}/integrations/aws/connections`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create AWS connection');
      }
      return res.json();
    },

    validateAwsConnection: async (id: string): Promise<{ valid: boolean; error?: string }> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/aws/connections/${encodeURIComponent(id)}/validate`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to validate AWS connection');
      }
      const result = await res.json();
      if (!result.valid) {
        throw new Error(result.error || 'AWS connection validation failed');
      }
      return result;
    },

    discoverOrgAccounts: async (
      id: string,
    ): Promise<{
      accounts: { id: string; name: string; status: string; email?: string }[];
    }> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/aws/connections/${encodeURIComponent(id)}/discover-org`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) throw new Error('Failed to discover AWS organization accounts');
      return res.json();
    },

    // Slack connection management
    createSlackWebhookConnection: async (payload: {
      displayName: string;
      webhookUrl: string;
    }): Promise<IntegrationConnection> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_V1_URL}/integrations/slack/connections`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create Slack connection');
      }
      return res.json();
    },

    testSlackConnection: async (id: string): Promise<{ ok: boolean; error?: string }> => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_V1_URL}/integrations/slack/connections/${encodeURIComponent(id)}/test`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      );
      if (!res.ok) throw new Error('Failed to test Slack connection');
      return res.json();
    },

    getProviderConfig: async (providerId: string): Promise<IntegrationProviderConfiguration> => {
      const response = await apiClient.getIntegrationProviderConfiguration(providerId);
      if (response.error || !response.data) {
        throw new Error('Failed to load provider configuration');
      }
      return response.data;
    },

    upsertProviderConfig: async (
      providerId: string,
      payload: UpsertProviderConfigRequest,
    ): Promise<IntegrationProviderConfiguration> => {
      const response = await apiClient.upsertIntegrationProviderConfiguration(providerId, payload);
      if (response.error || !response.data) {
        throw new Error('Failed to save provider configuration');
      }
      return response.data;
    },

    deleteProviderConfig: async (providerId: string): Promise<void> => {
      const response = await apiClient.deleteIntegrationProviderConfiguration(providerId);
      if (response.error) throw new Error('Failed to remove provider configuration');
    },
  },

  schedules: {
    list: async (filters?: { workflowId?: string | null; status?: ScheduleStatus }) => {
      const response = await apiClient.listSchedules({
        workflowId: filters?.workflowId ?? undefined,
        status: filters?.status,
      });
      if (response.error) throw new Error('Failed to fetch schedules');
      const payload = response.data as { schedules?: WorkflowSchedule[] } | undefined;
      return payload?.schedules ?? [];
    },

    get: async (id: string): Promise<WorkflowSchedule> => {
      return fetchScheduleById(id);
    },

    create: async (payload: CreateScheduleRequestDto): Promise<WorkflowSchedule> => {
      const response = await apiClient.createSchedule(payload);
      if (response.error) throw new Error('Failed to create schedule');
      const schedule = (response.data ?? null) as WorkflowSchedule | null;
      if (!schedule) {
        throw new Error('Schedule creation failed');
      }
      return schedule;
    },

    update: async (id: string, payload: UpdateScheduleRequestDto): Promise<WorkflowSchedule> => {
      const response = await apiClient.updateSchedule(id, payload);
      if (response.error) throw new Error('Failed to update schedule');
      const schedule = (response.data ?? null) as WorkflowSchedule | null;
      if (!schedule) {
        throw new Error('Schedule update failed');
      }
      return schedule;
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteSchedule(id);
      if (response.error) throw new Error('Failed to delete schedule');
    },

    pause: async (id: string): Promise<WorkflowSchedule> => {
      const response = await apiClient.pauseSchedule(id);
      if (response.error) throw new Error('Failed to pause schedule');
      return fetchScheduleById(id);
    },

    resume: async (id: string): Promise<WorkflowSchedule> => {
      const response = await apiClient.resumeSchedule(id);
      if (response.error) throw new Error('Failed to resume schedule');
      return fetchScheduleById(id);
    },

    runNow: async (id: string): Promise<void> => {
      const response = await apiClient.triggerSchedule(id);
      if (response.error) throw new Error('Failed to trigger schedule');
    },
  },

  apiKeys: {
    list: async (): Promise<ApiKeyResponseDto[]> => {
      const response = await apiClient.listApiKeys();
      if (response.error) throw new Error('Failed to fetch API keys');
      return response.data || [];
    },

    get: async (id: string): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.getApiKey(id);
      if (response.error) throw new Error('Failed to fetch API key');
      if (!response.data) throw new Error('API key not found');
      return response.data;
    },

    create: async (input: CreateApiKeyDto): Promise<CreateApiKeyResponseDto> => {
      const response = await apiClient.createApiKey(input);
      if (response.error) throw new Error('Failed to create API key');
      if (!response.data) throw new Error('API key creation failed');
      return response.data;
    },

    update: async (id: string, input: UpdateApiKeyDto): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.updateApiKey(id, input);
      if (response.error) throw new Error('Failed to update API key');
      if (!response.data) throw new Error('API key update failed');
      return response.data;
    },

    revoke: async (id: string): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.revokeApiKey(id);
      if (response.error) throw new Error('Failed to revoke API key');
      if (!response.data) throw new Error('API key revocation failed');
      return response.data;
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteApiKey(id);
      if (response.error) throw new Error('Failed to delete API key');
    },
  },

  auditLogs: {
    list: async (query: {
      resourceType?: string;
      resourceId?: string;
      action?: string;
      actorId?: string;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    }): Promise<ListAuditLogsResponseDto> => {
      const headers = await getAuthHeaders();
      const url = new URL(`${API_V1_URL}/audit-logs`);

      if (query.resourceType) url.searchParams.set('resourceType', query.resourceType);
      if (query.resourceId) url.searchParams.set('resourceId', query.resourceId);
      if (query.action) url.searchParams.set('action', query.action);
      if (query.actorId) url.searchParams.set('actorId', query.actorId);
      if (query.from) url.searchParams.set('from', query.from);
      if (query.to) url.searchParams.set('to', query.to);
      if (query.cursor) url.searchParams.set('cursor', query.cursor);
      if (query.limit) url.searchParams.set('limit', String(query.limit));

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch audit logs: ${res.status} ${text}`);
      }
      return (await res.json()) as ListAuditLogsResponseDto;
    },
  },

  executions: {
    start: async (
      workflowId: string,
      options?: {
        inputs?: Record<string, unknown>;
        versionId?: string;
        version?: number;
      },
    ): Promise<{ executionId: string }> => {
      const payload = options
        ? {
            inputs: options.inputs,
            versionId: options.versionId,
            version: options.version,
          }
        : undefined;
      const response = await apiClient.runWorkflow(workflowId, payload);
      if ((response as any).error) {
        const error = (response as any).error;
        const errorMessage =
          error?.message || (typeof error === 'string' ? error : 'Failed to start execution');
        throw new Error(errorMessage);
      }
      return { executionId: (response.data as any)?.runId || '' };
    },

    getStatus: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunStatus(executionId);
      if (response.error) throw new Error('Failed to fetch execution status');
      return response.data;
    },

    getTrace: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunTrace(executionId);
      if (response.error) throw new Error('Failed to fetch execution logs');
      return response.data;
    },

    getConfig: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunConfig(executionId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run configuration');
      }
      return response.data;
    },

    getResult: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunResult(executionId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run result');
      }
      return response.data;
    },

    getEvents: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunEvents(executionId);
      if (response.error) throw new Error('Failed to fetch events');
      return response.data || [];
    },

    getDataFlows: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunDataFlows(executionId);
      if (response.error) throw new Error('Failed to fetch data flows');
      return response.data || [];
    },

    getTerminalChunks: async (
      executionId: string,
      params?: {
        nodeRef?: string;
        stream?: string;
        cursor?: string;
        startTime?: Date;
        endTime?: Date;
      },
    ): Promise<TerminalChunkResponse> => {
      const headers = await getAuthHeaders();
      const path = `${API_V1_URL}/workflows/runs/${executionId}/terminal`;
      const url = new URL(path, window.location.origin);
      if (params?.nodeRef) url.searchParams.set('nodeRef', params.nodeRef);
      if (params?.stream) url.searchParams.set('stream', params.stream);
      if (params?.cursor) url.searchParams.set('cursor', params.cursor);
      if (params?.startTime) url.searchParams.set('startTime', params.startTime.toISOString());
      if (params?.endTime) url.searchParams.set('endTime', params.endTime.toISOString());
      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        throw new Error('Failed to fetch terminal chunks');
      }
      return (await response.json()) as TerminalChunkResponse;
    },

    getArtifacts: async (executionId: string): Promise<RunArtifactsResponse> => {
      const response = (await apiClient.getWorkflowRunArtifacts(executionId)) as any;
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run artifacts');
      }
      return response.data;
    },

    downloadArtifact: async (executionId: string, artifactId: string): Promise<Blob> => {
      // Use direct fetch instead of typed client due to OpenAPI spec mismatch
      // (path uses {artifactId} but parameter is named 'id')
      const headers = await getAuthHeaders();
      const response = await fetch(
        `${API_BASE_URL}/api/v1/workflows/runs/${executionId}/artifacts/${artifactId}/download`,
        { headers },
      );
      if (!response.ok) {
        throw new Error('Failed to download artifact');
      }
      return await response.blob();
    },

    stream: async (
      executionId: string,
      options?: {
        cursor?: string;
        temporalRunId?: string;
        terminalCursor?: string;
        logCursor?: string;
      },
    ): Promise<EventSource> => {
      // Use fetch-based SSE client that supports custom headers (including Authorization)
      const { FetchEventSource } = await import('@/utils/sse-client');

      const storeState = useAuthStore.getState();
      let token = storeState.token;
      const organizationId = storeState.organizationId;

      // For Clerk auth, fetch a fresh token
      if (storeState.provider === 'clerk') {
        try {
          const freshToken = await getFreshClerkToken();
          if (freshToken) {
            token = freshToken;
            storeState.setToken(freshToken);
          }
        } catch (_error) {
          // Ignore token fetch errors for SSE, will fallback to existing
        }
      }

      // Build URL with query params
      const params = new URLSearchParams();
      if (options?.cursor) params.set('cursor', options.cursor);
      if (options?.temporalRunId) params.set('temporalRunId', options.temporalRunId);
      if (options?.terminalCursor) params.set('terminalCursor', options.terminalCursor);
      if (options?.logCursor) params.set('logCursor', options.logCursor);
      const query = params.toString();
      const url = `${API_V1_URL}/workflows/runs/${executionId}/stream${query ? `?${query}` : ''}`;

      // Build auth headers
      const headers: Record<string, string> = {};
      // For local auth with admin credentials, use Basic Auth
      if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
        const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`);
        headers['Authorization'] = `Basic ${credentials}`;
      } else if (token && token.trim().length > 0) {
        const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        headers['Authorization'] = headerValue;
      }
      if (organizationId && organizationId.trim().length > 0) {
        headers['X-Organization-Id'] = organizationId;
      }

      return new FetchEventSource(url, { headers });
    },

    cancel: async (executionId: string) => {
      const response = await apiClient.cancelWorkflowRun(executionId);
      if (response.error) throw new Error('Failed to cancel execution');
      return { success: true };
    },

    listRuns: async (options?: {
      workflowId?: string;
      workflowIds?: string;
      status?: string;
      triggerType?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }) => {
      const response = await apiClient.listWorkflowRuns(options);
      if (response.error) throw new Error('Failed to fetch runs');
      return response.data || { runs: [] };
    },

    getRunActivity: async (options?: { days?: number }) => {
      const response = await apiClient.getRunActivity(options);
      if (response.error) throw new Error('Failed to fetch run activity');
      return response.data || { totalRuns: 0, activity: [] };
    },

    getRun: async (runId: string) => {
      const response = await apiClient.getWorkflowRun(runId);
      if (response.error) throw new Error('Failed to fetch run');
      if (!response.data) throw new Error('Run not found');
      return response.data;
    },

    getChildRuns: async (runId: string) => {
      const response = await apiClient.listWorkflowRunChildren(runId);
      if (response.error) throw new Error('Failed to fetch child runs');
      return response.data || { runs: [] };
    },

    listNodeIO: async (runId: string) => {
      const response = await apiClient.listWorkflowRunNodeIO(runId);
      if (response.error) throw new Error('Failed to fetch node I/O');
      return response.data || [];
    },

    getNodeIO: async (runId: string, nodeRef: string, full?: boolean) => {
      const response = await apiClient.getWorkflowNodeIO(runId, nodeRef, { full });
      if (response.error) throw new Error('Failed to fetch node I/O details');
      return response.data;
    },

    getLogs: async (
      runId: string,
      options?: {
        nodeRef?: string;
        stream?: 'stdout' | 'stderr' | 'console';
        level?: 'debug' | 'info' | 'warn' | 'error';
        limit?: number;
        cursor?: string;
        startTime?: string;
        endTime?: string;
      },
    ) => {
      const client = createShipSecClient({
        baseUrl: API_BASE_URL,
        middleware: {
          async onRequest({ request }) {
            const headers = await getAuthHeaders();
            if (headers['Authorization']) {
              request.headers.set('Authorization', headers['Authorization']);
            }
            if (headers['X-Organization-Id']) {
              request.headers.set('X-Organization-Id', headers['X-Organization-Id']);
            }
            return request;
          },
        },
      });

      const response = await client.getWorkflowRunLogs(runId, options);
      if (response.error) {
        throw new Error('Failed to fetch logs');
      }
      return response.data as {
        runId: string;
        logs: {
          id: string;
          runId: string;
          nodeId: string;
          level: 'debug' | 'info' | 'warn' | 'error';
          message: string;
          timestamp: string;
        }[];
        totalCount: number;
        hasMore: boolean;
        nextCursor?: string;
      };
    },
  },

  files: {
    list: async () => {
      const response = await apiClient.listFiles();
      if (response.error) throw new Error('Failed to fetch files');
      return response.data;
    },

    upload: async (file: File) => {
      const response = (await apiClient.uploadFile(file)) as any;
      if (response.error) {
        const errorMessage =
          response.error instanceof Error
            ? response.error.message
            : typeof response.error === 'string'
              ? response.error
              : 'Failed to upload file';
        throw new Error(errorMessage);
      }
      return response.data;
    },

    download: async (id: string) => {
      return apiClient.downloadFile(id);
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteFile(id);
      if (response.error) throw new Error('Failed to delete file');
    },
  },

  artifacts: {
    list: async (filters?: ArtifactListFilters) => {
      const response = (await apiClient.listArtifacts(filters)) as any;
      if (response.error) {
        throw new Error('Failed to fetch artifacts');
      }
      return response.data || { artifacts: [] };
    },

    download: async (id: string): Promise<Blob> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/artifacts/${id}/download`, {
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to download artifact');
      }
      return await response.blob();
    },

    delete: async (id: string): Promise<void> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/v1/artifacts/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) {
        throw new Error('Failed to delete artifact');
      }
    },
  },

  humanInputs: {
    list: async (filters: {
      status?: 'pending' | 'resolved' | 'expired' | 'cancelled';
      type?: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
    }) => {
      const response = await apiClient.listHumanInputs({
        status: filters.status,
        inputType: filters.type,
      });
      if (response.error) throw new Error('Failed to fetch human inputs');
      return response.data || [];
    },

    get: async (id: string) => {
      const response = await apiClient.getHumanInput(id);
      if (response.error) throw new Error('Failed to fetch human input');
      if (!response.data) throw new Error('Human input not found');
      return response.data;
    },

    resolve: async (
      id: string,
      payload: { status: 'resolved' | 'rejected'; responseData?: any; comment?: string },
    ) => {
      const response = await apiClient.resolveHumanInput(id, {
        responseData: {
          ...payload.responseData,
          resolution: payload.status, // Add explicit resolution field
          comment: payload.comment,
        },
      });
      if (response.error) throw new Error('Failed to resolve human input');
      return response.data;
    },
  },

  webhooks: {
    list: async (): Promise<WebhookConfiguration[]> => {
      const response = await apiClient.listWebhookConfigurations();
      if (response.error) throw new Error('Failed to fetch webhook configurations');
      return (response.data || []) as WebhookConfiguration[];
    },

    get: async (id: string): Promise<WebhookConfiguration> => {
      const response = await apiClient.getWebhookConfiguration(id);
      if (response.error || !response.data)
        throw new Error('Failed to fetch webhook configuration');
      return response.data as WebhookConfiguration;
    },

    create: async (payload: Partial<WebhookConfiguration>): Promise<WebhookConfiguration> => {
      const response = await apiClient.createWebhookConfiguration(payload as any);
      if (response.error) throw new Error('Failed to create webhook configuration');
      return response.data as WebhookConfiguration;
    },

    update: async (
      id: string,
      payload: Partial<WebhookConfiguration>,
    ): Promise<WebhookConfiguration> => {
      const response = await apiClient.updateWebhookConfiguration(id, payload as any);
      if (response.error) throw new Error('Failed to update webhook configuration');
      return response.data as WebhookConfiguration;
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteWebhookConfiguration(id);
      if (response.error) throw new Error('Failed to delete webhook configuration');
    },

    testScript: async (payload: {
      script: string;
      payload: any;
      headers: Record<string, string>;
    }): Promise<TestWebhookScriptResponse> => {
      const response = await apiClient.testWebhookScript({
        parsingScript: payload.script,
        testPayload: payload.payload,
        testHeaders: payload.headers,
      });
      if (response.error) throw new Error('Failed to test webhook script');
      return response.data as TestWebhookScriptResponse;
    },

    listDeliveries: async (id: string): Promise<WebhookDelivery[]> => {
      const response = await apiClient.listDeliveries(id);
      if (response.error) throw new Error('Failed to fetch webhook deliveries');
      return (response.data || []) as WebhookDelivery[];
    },
  },

  asm: {
    listDomains: async (options?: { limit?: number; offset?: number }) => {
      const response = await apiClient.listAsmDomains(options);
      if (response.error) throw new Error('Failed to fetch ASM domains');
      return response.data || [];
    },

    getDomain: async (id: string) => {
      const response = await apiClient.getAsmDomain(id);
      if (response.error) throw new Error('Failed to fetch ASM domain');
      if (!response.data) throw new Error('ASM domain not found');
      return response.data;
    },

    createDomain: async (body: {
      domain: string;
      scopeInclude?: string[];
      scopeExclude?: string[];
      scanNow?: boolean;
    }) => {
      const response = await apiClient.createAsmDomain({
        ...body,
        scanNow: body.scanNow ?? false,
      });
      if (response.error) throw new Error('Failed to create ASM domain');
      if (!response.data) throw new Error('ASM domain creation failed');
      return response.data;
    },

    updateDomain: async (
      id: string,
      body: {
        scopeInclude?: string[];
        scopeExclude?: string[];
      },
    ) => {
      const response = await apiClient.updateAsmDomain(id, body);
      if (response.error) throw new Error('Failed to update ASM domain');
      if (!response.data) throw new Error('ASM domain update failed');
      return response.data;
    },

    deleteDomain: async (id: string) => {
      const response = await apiClient.deleteAsmDomain(id);
      if (response.error) throw new Error('Failed to delete ASM domain');
      if (!response.data) throw new Error('ASM domain deletion failed');
      return response.data;
    },

    triggerDomainScan: async (id: string, body?: { templateSlug?: string }) => {
      const response = await apiClient.triggerAsmDomainScan(id, {
        templateSlug: body?.templateSlug ?? 'sys-attack-surface-recon',
      });
      if (response.error) throw new Error('Failed to trigger ASM domain scan');
      if (!response.data) throw new Error('ASM scan trigger failed');
      return response.data;
    },

    listScans: async (options?: {
      limit?: number;
      offset?: number;
      status?: string;
      domainId?: string;
    }) => {
      const response = await apiClient.listAsmScans({
        ...options,
        status: options?.status as 'running' | 'completed' | 'failed' | 'timed_out' | undefined,
      });
      if (response.error) throw new Error('Failed to fetch ASM scans');
      return response.data || { runs: [], total: 0 };
    },

    getStats: async () => {
      const response = await apiClient.getAsmStats();
      if (response.error) throw new Error('Failed to fetch ASM stats');
      if (!response.data) throw new Error('ASM stats not found');
      return response.data;
    },
  },

  cloudInventory: {
    listAssets: async (options?: {
      limit?: number;
      offset?: number;
      assetType?: string;
      region?: string;
      status?: 'active' | 'stale' | 'removed';
      search?: string;
      sortBy?: 'name' | 'lastSeenAt' | 'firstDiscoveredAt';
      sortOrder?: 'asc' | 'desc';
    }) => {
      const response = await apiClient.listCloudAssets(options);
      if (response.error) throw new Error('Failed to fetch cloud assets');
      return response.data || { assets: [], total: 0, page: 1, limit: options?.limit ?? 50 };
    },

    getSummary: async () => {
      const response = await apiClient.getCloudAssetSummary();
      if (response.error) throw new Error('Failed to fetch cloud asset summary');
      if (!response.data) throw new Error('Cloud asset summary not found');
      return response.data;
    },

    getAsset: async (id: string) => {
      const response = await apiClient.getCloudAsset(id);
      if (response.error) throw new Error('Failed to fetch cloud asset');
      if (!response.data) throw new Error('Cloud asset not found');
      return response.data;
    },

    triggerSync: async (integrationId: string) => {
      const response = await apiClient.triggerCloudSync({ integrationId });
      if (response.error) throw new Error('Failed to trigger cloud sync');
      if (!response.data) throw new Error('Cloud sync trigger failed');
      return response.data;
    },

    listSyncRuns: async (options?: { limit?: number; offset?: number }) => {
      const response = await apiClient.listCloudSyncRuns(options);
      if (response.error) throw new Error('Failed to fetch cloud sync runs');
      return response.data || { syncRuns: [], total: 0, page: 1, limit: options?.limit ?? 20 };
    },

    getSyncRun: async (id: string) => {
      const response = await apiClient.getCloudSyncRun(id);
      if (response.error) throw new Error('Failed to fetch cloud sync run');
      if (!response.data) throw new Error('Cloud sync run not found');
      return response.data;
    },
  },

  analytics: {
    query: async (body: {
      query?: Record<string, any>;
      size?: number;
      from?: number;
      aggs?: Record<string, any>;
      sort?: Record<string, any>[];
      collapse?: Record<string, any>;
      useLatest?: boolean;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/analytics/query`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Analytics query failed: ${response.status}`);
      return response.json() as Promise<{
        total: number;
        hits: { _id: string; _source: Record<string, any>; _score?: number }[];
        aggregations?: Record<string, any>;
      }>;
    },

    prowlerChecksMetadata: async (): Promise<Record<string, ProwlerCheckMetadata>> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/analytics/prowler-checks-metadata`, {
        method: 'GET',
        headers,
      });
      if (!response.ok) throw new Error(`Prowler checks metadata failed: ${response.status}`);
      return response.json();
    },

    batchRunSummaries: async (runIds: string[]) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/analytics/batch-run-summaries`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ runIds }),
      });
      if (!response.ok) throw new Error(`Batch run summaries failed: ${response.status}`);
      return response.json() as Promise<{
        summaries: Record<
          string,
          { critical: number; high: number; medium: number; low: number; info: number }
        >;
      }>;
    },
  },
};

export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeaders();
}

export default api;
