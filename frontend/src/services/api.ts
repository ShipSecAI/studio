import { createShipSecClient } from '../../../packages/backend-client/src/api-client';
import type { components, operations, paths } from '../../../packages/backend-client/src/client';
import type { RunArtifactsResponse, WorkflowSchedule, ScheduleStatus } from '@shipsec/shared';
import { useAuthStore } from '@/store/authStore';
import { getFreshClerkToken } from '@/utils/clerk-token';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

export type ProwlerCheckMetadata =
  paths['/api/v1/analytics/prowler-checks-metadata']['get']['responses'][200]['content']['application/json'][string];
export type WorkflowSummary =
  paths['/api/v1/workflows/summary']['get']['responses'][200]['content']['application/json'][number];

export type IntegrationProvider = components['schemas']['IntegrationProviderResponse'];
export type IntegrationConnection = components['schemas']['IntegrationConnectionResponse'];
export type IntegrationProviderConfiguration =
  components['schemas']['ProviderConfigurationResponse'];
export type OAuthStartResponse = components['schemas']['OAuthStartResponseDto'];
export type ReportTemplate = components['schemas']['ReportTemplateResponseDto'];
export type RenderReportTemplateResponse = components['schemas']['RenderReportTemplateResponseDto'];

export type IntegrationCatalogEntry =
  paths['/api/v1/integrations/catalog']['get']['responses'][200]['content']['application/json'][number];

// Generated response types used to replace manual `as` casts
type WebhookConfiguration = components['schemas']['WebhookConfigurationResponseDto'];
type WebhookDelivery = components['schemas']['WebhookDeliveryResponseDto'];
type TestWebhookScriptResponse = components['schemas']['TestWebhookScriptResponseDto'];
type AwsSetupInfoResponse = components['schemas']['AwsSetupInfoResponseDto'];
type ValidateAwsResponse = components['schemas']['ValidateAwsResponseDto'];
type DiscoverOrgAccountsResponse = components['schemas']['DiscoverOrgAccountsResponseDto'];

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
  if (!response.data) {
    throw new Error('Schedule not found');
  }
  return response.data as WorkflowSchedule;
}

/**
 * API Service
 * Simple wrapper around the backend API client
 */
export const api = {
  templates: {
    list: async (params?: { category?: string; search?: string; tags?: string[] }) => {
      const searchParams = new URLSearchParams();
      if (params?.category) searchParams.set('category', params.category);
      if (params?.search) searchParams.set('search', params.search);
      if (params?.tags) searchParams.set('tags', params.tags.join(','));

      const headers = await getAuthHeaders();
      const response = await fetch(
        `${API_V1_URL}/templates${searchParams.toString() ? `?${searchParams.toString()}` : ''}`,
        { headers },
      );

      if (!response.ok) throw new Error('Failed to fetch templates');
      return response.json();
    },

    get: async (id: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/${id}`, { headers });
      if (!response.ok) throw new Error('Failed to fetch template');
      return response.json();
    },

    getCategories: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/categories`, { headers });
      if (!response.ok) throw new Error('Failed to fetch categories');
      return response.json();
    },

    getTags: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/tags`, { headers });
      if (!response.ok) throw new Error('Failed to fetch tags');
      return response.json();
    },

    publish: async (data: {
      workflowId: string;
      name: string;
      description: string;
      category: string;
      tags: string[];
      author: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/publish`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to publish template' }));
        throw new Error(errorData.message || 'Failed to publish template');
      }

      return response.json();
    },

    use: async (
      templateId: string,
      data: { workflowName: string; secretMappings?: Record<string, string> },
    ): Promise<{ workflowId?: string; workflow?: { id?: string } }> => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/${templateId}/use`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to use template' }));
        throw new Error(errorData.message || 'Failed to use template');
      }

      return response.json() as Promise<{ workflowId?: string; workflow?: { id?: string } }>;
    },

    sync: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/sync`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) throw new Error('Failed to sync templates');
      return response.json();
    },

    getMySubmissions: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/my`, { headers });
      if (!response.ok) throw new Error('Failed to fetch submissions');
      return response.json();
    },

    getSubmissions: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_V1_URL}/templates/submissions`, { headers });
      if (!response.ok) throw new Error('Failed to fetch submissions');
      return response.json();
    },
  },

  onboarding: {
    getPreferences: async (): Promise<components['schemas']['OnboardingPreferencesDto']> => {
      const response = await apiClient.getOnboardingPreferences();
      if (response.error || !response.data) {
        throw new Error('Failed to fetch onboarding preferences');
      }
      return response.data;
    },

    updatePreferences: async (
      updates: components['schemas']['UpdateOnboardingPreferencesDto'],
    ): Promise<components['schemas']['OnboardingPreferencesDto']> => {
      const response = await apiClient.updateOnboardingPreferences(updates);
      if (response.error || !response.data) {
        throw new Error('Failed to update onboarding preferences');
      }
      return response.data;
    },
  },
  workflows: {
    list: async (): Promise<components['schemas']['WorkflowResponseDto'][]> => {
      const response = await apiClient.listWorkflows();
      if (response.error) throw new Error('Failed to fetch workflows');
      return response.data || [];
    },

    listSummary: async (): Promise<WorkflowSummary[]> => {
      const response = await apiClient.listWorkflowSummaries();
      if (response.error) throw new Error('Failed to fetch workflow summaries');
      return response.data ?? [];
    },

    get: async (id: string): Promise<components['schemas']['WorkflowResponseDto']> => {
      const response = await apiClient.getWorkflow(id);
      if (response.error) throw new Error('Failed to fetch workflow');
      if (!response.data) throw new Error('Workflow not found');
      return response.data;
    },

    getVersion: async (
      workflowId: string,
      versionId: string,
    ): Promise<components['schemas']['WorkflowVersionResponseDto']> => {
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

    create: async (
      workflow: components['schemas']['CreateWorkflowRequestDto'],
    ): Promise<components['schemas']['WorkflowResponseDto']> => {
      const response = await apiClient.createWorkflow(workflow);
      if (response.error) throw new Error('Failed to create workflow');
      if (!response.data) throw new Error('Workflow creation failed');
      return response.data;
    },

    update: async (
      id: string,
      workflow: components['schemas']['UpdateWorkflowRequestDto'],
    ): Promise<components['schemas']['WorkflowResponseDto']> => {
      const response = await apiClient.updateWorkflow(id, workflow);
      if (response.error) throw new Error('Failed to update workflow');
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
    ): Promise<components['schemas']['WorkflowResponseDto']> => {
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
      const response = await apiClient.commitWorkflow(id);
      if (response.error) throw new Error('Failed to commit workflow');
      return response.data;
    },

    run: async (
      id: string,
      body?: { inputs?: NonNullable<components['schemas']['RunWorkflowRequestDto']['inputs']> },
    ) => {
      const response = await apiClient.runWorkflow(id, body);
      if (response.error) throw new Error('Failed to run workflow');
      return response.data;
    },
  },

  reportTemplates: {
    list: async (): Promise<ReportTemplate[]> => {
      const response = await apiClient.listReportTemplates();
      if (response.error) throw new Error('Failed to fetch report templates');
      return (response.data ?? []) as ReportTemplate[];
    },

    get: async (id: string): Promise<ReportTemplate> => {
      const response = await apiClient.getReportTemplate(id);
      if (response.error || !response.data) throw new Error('Failed to fetch report template');
      return response.data as ReportTemplate;
    },

    getDraft: async (id: string): Promise<ReportTemplate> => {
      const response = await apiClient.getReportTemplateDraft(id);
      if (response.error || !response.data)
        throw new Error('Failed to fetch report template draft');
      return response.data as ReportTemplate;
    },

    createDraft: async (
      body: components['schemas']['CreateReportTemplateDraftRequestDto'],
    ): Promise<ReportTemplate> => {
      const response = await apiClient.createReportTemplateDraft(body);
      if (response.error || !response.data)
        throw new Error('Failed to create report template draft');
      return response.data as ReportTemplate;
    },

    updateDraft: async (
      id: string,
      body: components['schemas']['UpdateReportTemplateDraftRequestDto'],
    ): Promise<ReportTemplate> => {
      const response = await apiClient.updateReportTemplateDraft(id, body);
      if (response.error || !response.data)
        throw new Error('Failed to update report template draft');
      return response.data as ReportTemplate;
    },

    preview: async (
      id: string,
      body: components['schemas']['RenderReportTemplatePreviewRequestDto'],
    ): Promise<RenderReportTemplateResponse> => {
      const response = await apiClient.previewReportTemplate(id, body);
      if (response.error || !response.data)
        throw new Error('Failed to render report template preview');
      return response.data as RenderReportTemplateResponse;
    },

    publish: async (id: string): Promise<ReportTemplate> => {
      const response = await apiClient.publishReportTemplate(id, {});
      if (response.error || !response.data) throw new Error('Failed to publish report template');
      return response.data as ReportTemplate;
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

    resolvePorts: async (
      id: string,
      params: components['schemas']['ResolvePortsRequestDto'],
    ): Promise<components['schemas']['ResolvePortsResponseDto']> => {
      const response = await apiClient.resolveComponentPorts(id, params);
      if (response.error || !response.data) {
        throw new Error('Failed to resolve ports');
      }
      return response.data;
    },
  },

  secrets: {
    list: async (): Promise<components['schemas']['SecretSummaryResponse'][]> => {
      const response = await apiClient.listSecrets();
      if (response.error) throw new Error('Failed to fetch secrets');
      return response.data || [];
    },

    create: async (
      input: components['schemas']['CreateSecretDto'],
    ): Promise<components['schemas']['SecretSummaryResponse']> => {
      const response = await apiClient.createSecret(input);
      if (response.error) throw new Error('Failed to create secret');
      if (!response.data) throw new Error('Secret creation failed');
      return response.data;
    },

    update: async (
      id: string,
      input: components['schemas']['UpdateSecretDto'],
    ): Promise<components['schemas']['SecretSummaryResponse']> => {
      const response = await apiClient.updateSecret(id, input);
      if (response.error) throw new Error('Failed to update secret');
      if (!response.data) throw new Error('Secret update failed');
      return response.data;
    },

    rotate: async (
      id: string,
      input: components['schemas']['RotateSecretDto'],
    ): Promise<components['schemas']['SecretSummaryResponse']> => {
      const response = await apiClient.rotateSecret(id, input);
      if (response.error) throw new Error('Failed to rotate secret');
      if (!response.data) throw new Error('Secret rotation failed');
      return response.data;
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteSecret(id);
      if (response.error) throw new Error('Failed to delete secret');
    },

    getValue: async (
      id: string,
      version?: number,
    ): Promise<components['schemas']['SecretValueResponse']> => {
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
      return response.data ?? [];
    },

    // D6: org-scoped connection listing (primary source of truth)
    listOrgConnections: async (provider?: string): Promise<IntegrationConnection[]> => {
      const response = await apiClient.listOrgIntegrationConnections(provider);
      if (response.error) throw new Error('Failed to load org connections');
      return response.data ?? [];
    },

    // D5: Provider catalog (AWS + Slack definitions)
    getCatalog: async (): Promise<IntegrationCatalogEntry[]> => {
      const response = await apiClient.getIntegrationCatalog();
      if (response.error) throw new Error('Failed to load integration catalog');
      return response.data ?? [];
    },

    // D16: userId removed from OAuth payloads
    startOAuth: async (
      providerId: string,
      payload: { redirectUri: string; scopes?: string[] },
    ): Promise<OAuthStartResponse> => {
      const response = await apiClient.startIntegrationOAuth(providerId, payload);
      if (response.error || !response.data) throw new Error('Failed to start OAuth flow');
      return response.data;
    },

    completeOAuth: async (
      providerId: string,
      payload: { redirectUri: string; state: string; code: string; scopes?: string[] },
    ): Promise<IntegrationConnection> => {
      const response = await apiClient.completeIntegrationOAuth(providerId, payload);
      if (response.error || !response.data) throw new Error('Failed to complete OAuth exchange');
      return response.data;
    },

    // D16: userId removed, derived from auth context
    refreshConnection: async (id: string): Promise<IntegrationConnection> => {
      const response = await apiClient.refreshIntegrationConnection(id);
      if (response.error || !response.data)
        throw new Error('Failed to refresh integration connection');
      return response.data;
    },

    // D16: userId removed, derived from auth context
    disconnect: async (id: string): Promise<void> => {
      const response = await apiClient.disconnectIntegrationConnection(id);
      if (response.error) throw new Error('Failed to disconnect integration');
    },

    // AWS setup info (generates trust policy + external ID + setup token)
    getAwsSetupInfo: async (): Promise<AwsSetupInfoResponse> => {
      const response = await apiClient.getAwsSetupInfo();
      if (response.error || !response.data) {
        throw new Error('Failed to load AWS setup info');
      }
      return response.data;
    },

    // AWS connection management (IAM role only)
    createAwsConnection: async (payload: {
      displayName: string;
      roleArn: string;
      region?: string;
      externalId: string;
      setupToken: string;
    }): Promise<IntegrationConnection> => {
      const response = await apiClient.createAwsIntegrationConnection(payload);
      if (response.error || !response.data) {
        throw new Error('Failed to create AWS connection');
      }
      return response.data;
    },

    validateAwsConnection: async (id: string): Promise<ValidateAwsResponse> => {
      const response = await apiClient.validateAwsIntegrationConnection(id);
      if (response.error || !response.data) {
        throw new Error('Failed to validate AWS connection');
      }
      if (!response.data.valid) {
        throw new Error(response.data.error || 'AWS connection validation failed');
      }
      return response.data;
    },

    discoverOrgAccounts: async (id: string): Promise<DiscoverOrgAccountsResponse> => {
      const response = await apiClient.discoverAwsOrganizationAccounts(id);
      if (response.error || !response.data) {
        throw new Error('Failed to discover AWS organization accounts');
      }
      return response.data;
    },

    // Slack connection management
    createSlackWebhookConnection: async (payload: {
      displayName: string;
      webhookUrl: string;
    }): Promise<IntegrationConnection> => {
      const response = await apiClient.createSlackWebhookIntegrationConnection(payload);
      if (response.error || !response.data) {
        throw new Error('Failed to create Slack connection');
      }
      return response.data;
    },

    // Jira connection management
    createJiraForgeConnection: async (payload: {
      displayName: string;
      webTriggerUrl: string;
      sharedSecret?: string;
    }): Promise<IntegrationConnection> => {
      const response = await apiClient.createJiraForgeIntegrationConnection(payload);
      if (response.error || !response.data) {
        throw new Error('Failed to create Jira connection');
      }
      return response.data;
    },

    // Jira site discovery
    discoverJiraSite: async (
      siteHostname: string,
    ): Promise<{ found: boolean; hostname?: string; environment?: string }> => {
      const res = await fetch('/api/v1/integrations/jira/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteHostname }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || 'Failed to discover Jira installation',
        );
      }
      return res.json();
    },

    connectJiraSite: async (siteHostname: string): Promise<IntegrationConnection> => {
      const res = await fetch('/api/v1/integrations/jira/connect-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteHostname }),
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || 'Failed to connect Jira');
      }
      return res.json();
    },

    testSlackConnection: async (id: string): Promise<{ ok: boolean; error?: string }> => {
      const response = await apiClient.testSlackIntegrationConnection(id);
      if (response.error || !response.data) throw new Error('Failed to test Slack connection');
      return response.data as { ok: boolean; error?: string };
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
      payload: components['schemas']['UpsertProviderConfigDto'],
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

    create: async (
      payload: components['schemas']['CreateScheduleRequestDto'],
    ): Promise<WorkflowSchedule> => {
      const response = await apiClient.createSchedule(payload);
      if (response.error) throw new Error('Failed to create schedule');
      const schedule = (response.data ?? null) as WorkflowSchedule | null;
      if (!schedule) {
        throw new Error('Schedule creation failed');
      }
      return schedule;
    },

    update: async (
      id: string,
      payload: components['schemas']['UpdateScheduleRequestDto'],
    ): Promise<WorkflowSchedule> => {
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
    list: async (): Promise<components['schemas']['ApiKeyResponseDto'][]> => {
      const response = await apiClient.listApiKeys();
      if (response.error) throw new Error('Failed to fetch API keys');
      return response.data || [];
    },

    get: async (id: string): Promise<components['schemas']['ApiKeyResponseDto']> => {
      const response = await apiClient.getApiKey(id);
      if (response.error) throw new Error('Failed to fetch API key');
      if (!response.data) throw new Error('API key not found');
      return response.data;
    },

    create: async (
      input: components['schemas']['CreateApiKeyDto'],
    ): Promise<components['schemas']['CreateApiKeyResponseDto']> => {
      const response = await apiClient.createApiKey(input);
      if (response.error) throw new Error('Failed to create API key');
      if (!response.data) throw new Error('API key creation failed');
      return response.data;
    },

    update: async (
      id: string,
      input: components['schemas']['UpdateApiKeyDto'],
    ): Promise<components['schemas']['ApiKeyResponseDto']> => {
      const response = await apiClient.updateApiKey(id, input);
      if (response.error) throw new Error('Failed to update API key');
      if (!response.data) throw new Error('API key update failed');
      return response.data;
    },

    revoke: async (id: string): Promise<components['schemas']['ApiKeyResponseDto']> => {
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
    list: async (
      query: {
        resourceType?: string;
        resourceId?: string;
        action?: string;
        actorId?: string;
        from?: string;
        to?: string;
        limit?: number;
        cursor?: string;
      } = {},
    ): Promise<components['schemas']['ListAuditLogsResponseDto']> => {
      const response = await apiClient.listAuditLogs(query);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch audit logs');
      }
      return response.data;
    },
  },

  executions: {
    start: async <
      TInputs extends NonNullable<components['schemas']['RunWorkflowRequestDto']['inputs']>,
    >(
      workflowId: string,
      options?: {
        inputs?: TInputs;
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
      if (response.error || !response.data?.runId) {
        throw new Error('Failed to start execution');
      }
      return { executionId: response.data.runId };
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
      params?: Omit<
        NonNullable<operations['WorkflowsController_terminalChunks']['parameters']['query']>,
        'startTime' | 'endTime'
      > & {
        startTime?: Date;
        endTime?: Date;
      },
    ): Promise<components['schemas']['TerminalChunksResponseDto']> => {
      const response = await apiClient.getWorkflowRunTerminal(executionId, {
        nodeRef: params?.nodeRef,
        stream: params?.stream,
        cursor: params?.cursor,
        startTime: params?.startTime?.toISOString(),
        endTime: params?.endTime?.toISOString(),
      });
      if (response.error || !response.data) {
        throw new Error('Failed to fetch terminal chunks');
      }
      return response.data;
    },

    getArtifacts: async (executionId: string): Promise<RunArtifactsResponse> => {
      const response = await apiClient.getWorkflowRunArtifacts(executionId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run artifacts');
      }
      return {
        runId: response.data.runId,
        artifacts: response.data.artifacts.map((artifact) => ({
          ...artifact,
          workflowVersionId: artifact.workflowVersionId ?? null,
          metadata: artifact.metadata ?? undefined,
        })),
      };
    },

    downloadArtifact: async (executionId: string, artifactId: string): Promise<Blob> => {
      return apiClient.downloadWorkflowRunArtifact(executionId, artifactId);
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
      return response.data;
    },
  },

  files: {
    list: async () => {
      const response = await apiClient.listFiles();
      if (response.error) throw new Error('Failed to fetch files');
      return response.data;
    },

    upload: async (file: File) => {
      const response = await apiClient.uploadFile(file);
      if (response.error) throw new Error('Failed to upload file');
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
    list: async (
      filters?: operations['ArtifactsController_listArtifacts']['parameters']['query'],
    ) => {
      const response = await apiClient.listArtifacts(filters);
      if (response.error) throw new Error('Failed to fetch artifacts');
      return response.data || { artifacts: [] };
    },

    download: async (id: string): Promise<Blob> => {
      return apiClient.downloadArtifact(id);
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteArtifact(id);
      if (response.error) throw new Error('Failed to delete artifact');
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
      payload: { status: 'resolved' | 'rejected'; responseData?: JsonObject; comment?: string },
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
      return response.data || [];
    },

    get: async (id: string): Promise<WebhookConfiguration> => {
      const response = await apiClient.getWebhookConfiguration(id);
      if (response.error || !response.data)
        throw new Error('Failed to fetch webhook configuration');
      return response.data;
    },

    create: async (
      payload: components['schemas']['CreateWebhookRequestDto'],
    ): Promise<WebhookConfiguration> => {
      const response = await apiClient.createWebhookConfiguration(payload);
      if (response.error || !response.data)
        throw new Error('Failed to create webhook configuration');
      return response.data;
    },

    update: async (
      id: string,
      payload: components['schemas']['UpdateWebhookRequestDto'],
    ): Promise<WebhookConfiguration> => {
      const response = await apiClient.updateWebhookConfiguration(id, payload);
      if (response.error || !response.data)
        throw new Error('Failed to update webhook configuration');
      return response.data;
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteWebhookConfiguration(id);
      if (response.error) throw new Error('Failed to delete webhook configuration');
    },

    testScript: async (payload: {
      script: string;
      payload: JsonObject;
      headers: Record<string, string>;
    }): Promise<TestWebhookScriptResponse> => {
      const request: components['schemas']['TestWebhookScriptRequestDto'] = {
        parsingScript: payload.script,
        testPayload: payload.payload,
        testHeaders: payload.headers,
      };
      const response = await apiClient.testWebhookScript(request);
      if (response.error || !response.data) throw new Error('Failed to test webhook script');
      return response.data;
    },

    listDeliveries: async (id: string): Promise<WebhookDelivery[]> => {
      const response = await apiClient.listDeliveries(id);
      if (response.error) throw new Error('Failed to fetch webhook deliveries');
      return response.data || [];
    },

    regeneratePath: async (id: string) => {
      const response = await apiClient.regenerateWebhookPath(id);
      if (response.error || !response.data) {
        throw new Error('Failed to regenerate webhook path');
      }
      return response.data;
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
      if (!response.data) throw new Error('ASM scans data not found');
      return response.data;
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

  mcpDiscovery: {
    discover: async (input: components['schemas']['DiscoveryInputDto']) => {
      const response = await apiClient.discoverMcpTools(input);
      if (response.error || !response.data) throw new Error('Failed to start MCP discovery');
      return response.data;
    },

    getStatus: async (workflowId: string): Promise<components['schemas']['DiscoveryStatusDto']> => {
      const response = await apiClient.getMcpDiscoveryStatus(workflowId);
      if (response.error || !response.data) throw new Error('Failed to fetch discovery status');
      return response.data;
    },

    discoverGroup: async (input: components['schemas']['GroupDiscoveryInputDto']) => {
      const response = await apiClient.discoverMcpGroupTools(input);
      if (response.error || !response.data) throw new Error('Failed to start MCP group discovery');
      return response.data;
    },

    getGroupStatus: async (
      workflowId: string,
    ): Promise<components['schemas']['GroupDiscoveryStatusDto']> => {
      const response = await apiClient.getMcpGroupDiscoveryStatus(workflowId);
      if (response.error || !response.data) {
        throw new Error('Failed to fetch group discovery status');
      }
      return response.data;
    },
  },

  mcpGroups: {
    list: async (options?: {
      enabled?: boolean;
      includeServers?: boolean;
    }): Promise<components['schemas']['McpGroupResponseDto'][]> => {
      const response = await apiClient.listMcpGroups(options);
      if (response.error) throw new Error('Failed to fetch MCP groups');
      return response.data ?? [];
    },

    listTemplates: async (): Promise<components['schemas']['GroupTemplateDto'][]> => {
      const response = await apiClient.listMcpGroupTemplates();
      if (response.error) throw new Error('Failed to fetch group templates');
      return response.data ?? [];
    },

    get: async (id: string): Promise<components['schemas']['McpGroupResponseDto']> => {
      const response = await apiClient.getMcpGroup(id);
      if (response.error || !response.data) throw new Error('Failed to fetch MCP group');
      return response.data;
    },

    getServers: async (id: string) => {
      const response = await apiClient.listMcpGroupServers(id);
      if (response.error) throw new Error('Failed to fetch group servers');
      return response.data ?? [];
    },

    syncTemplates: async () => {
      const response = await apiClient.syncMcpGroupTemplates();
      if (response.error || !response.data) throw new Error('Failed to sync group templates');
      return response.data;
    },

    importTemplate: async (slug: string, serverCacheTokens?: Record<string, string>) => {
      const body: components['schemas']['ImportTemplateRequestDto'] = serverCacheTokens
        ? { serverCacheTokens }
        : {};
      const response = await apiClient.importMcpGroupTemplate(slug, body);
      if (response.error || !response.data) throw new Error('Failed to import group template');
      return response.data;
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteMcpGroup(id);
      if (response.error) throw new Error('Failed to delete group');
    },
  },

  mcpServers: {
    list: async (groupId?: string) => {
      const response = await apiClient.listMcpServers(groupId);
      if (response.error) throw new Error('Failed to fetch MCP servers');
      return response.data ?? [];
    },

    listTools: async () => {
      const response = await apiClient.listMcpTools();
      if (response.error) throw new Error('Failed to fetch MCP tools');
      return response.data ?? [];
    },

    create: async (input: components['schemas']['CreateMcpServerDto']) => {
      const response = await apiClient.createMcpServer(input);
      if (response.error || !response.data) throw new Error('Failed to create MCP server');
      return response.data;
    },

    update: async (id: string, input: components['schemas']['UpdateMcpServerDto']) => {
      const response = await apiClient.updateMcpServer(id, input);
      if (response.error || !response.data) throw new Error('Failed to update MCP server');
      return response.data;
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteMcpServer(id);
      if (response.error) throw new Error('Failed to delete MCP server');
    },

    toggle: async (id: string) => {
      const response = await apiClient.toggleMcpServer(id);
      if (response.error || !response.data) throw new Error('Failed to update MCP server');
      return response.data;
    },

    test: async (id: string) => {
      const response = await apiClient.testMcpServerConnection(id);
      if (response.error || !response.data) throw new Error('Failed to test MCP connection');
      return response.data;
    },

    listServerTools: async (id: string) => {
      const response = await apiClient.listMcpServerTools(id);
      if (response.error) throw new Error('Failed to fetch server tools');
      return response.data ?? [];
    },

    toggleTool: async (serverId: string, toolId: string) => {
      const response = await apiClient.toggleMcpServerTool(serverId, toolId);
      if (response.error || !response.data) throw new Error('Failed to toggle MCP tool');
      return response.data;
    },
  },

  chat: {
    listSessions: async () => {
      const response = await apiClient.listChatSessions();
      if (response.error || !response.data) throw new Error('Failed to fetch chat sessions');
      return response.data;
    },

    createSession: async (body?: { title?: string }) => {
      const response = await apiClient.createChatSession(body ?? {});
      if (response.error || !response.data) throw new Error('Failed to create chat session');
      return response.data;
    },

    updateSession: async (id: string, body: { title: string }) => {
      const response = await apiClient.updateChatSession(id, body);
      if (response.error || !response.data) throw new Error('Failed to update chat session');
      return response.data;
    },

    deleteSession: async (id: string) => {
      const response = await apiClient.deleteChatSession(id);
      if (response.error) throw new Error('Failed to delete chat session');
      return response.data;
    },
  },

  agents: {
    listParts: async (agentRunId: string, cursor?: string) => {
      const response = await apiClient.getAgentParts(agentRunId, cursor);
      if (response.error || !response.data) throw new Error('Failed to fetch agent trace parts');
      return response.data;
    },
  },

  workflowTemplates: {
    list: async () => {
      const response = await apiClient.listWorkflowTemplates();
      if (response.error || !response.data) throw new Error('Failed to fetch workflow templates');
      return response.data;
    },

    instantiate: async (id: string) => {
      const response = await apiClient.instantiateWorkflowTemplate(id, {});
      if (response.error || !response.data) {
        throw new Error('Failed to create workflow from template');
      }
      return response.data;
    },
  },

  github: {
    getStatus: async () => {
      const response = await apiClient.getGitHubStatus();
      if (response.error || !response.data) throw new Error('Failed to fetch GitHub status');
      return response.data;
    },

    listInstallations: async () => {
      const response = await apiClient.listGitHubInstallations();
      if (response.error || !response.data) throw new Error('Failed to fetch installations');
      return response.data;
    },

    listRepositories: async () => {
      const response = await apiClient.listGitHubRepositories();
      if (response.error || !response.data) throw new Error('Failed to fetch repositories');
      return response.data;
    },

    listBranches: async (id: string) => {
      const response = await apiClient.listGitHubBranches(id);
      if (response.error || !response.data) throw new Error('Failed to fetch branches');
      return response.data;
    },

    listTriggerRules: async () => {
      const response = await apiClient.listGitHubTriggerRules();
      if (response.error || !response.data) throw new Error('Failed to fetch trigger rules');
      return response.data;
    },

    listScans: async (
      query?: operations['GitHubAppController_listScanResults']['parameters']['query'],
    ) => {
      const response = await apiClient.listGitHubScans(query);
      if (response.error || !response.data) throw new Error('Failed to fetch scan results');
      return response.data;
    },

    getScan: async (id: string) => {
      const response = await apiClient.getGitHubScan(id);
      if (response.error || !response.data) throw new Error('Failed to fetch scan result');
      return response.data;
    },

    setupInstallation: async (installationId: number) => {
      const response = await apiClient.setupGitHubInstallation({ installationId });
      if (response.error || !response.data) throw new Error('Failed to setup installation');
      return response.data;
    },

    toggleRepoScans: async (id: string, enabled: boolean) => {
      const response = await apiClient.toggleGitHubRepositoryScans(id, { enabled });
      if (response.error || !response.data) throw new Error('Failed to update repository');
      return response.data;
    },

    syncRepositories: async () => {
      const response = await apiClient.syncGitHubRepositories();
      if (response.error || !response.data) throw new Error('Failed to sync repositories');
      return response.data;
    },

    createTriggerRule: async (input: components['schemas']['CreateTriggerRuleDto']) => {
      const response = await apiClient.createGitHubTriggerRule(input);
      if (response.error || !response.data) throw new Error('Failed to create trigger rule');
      return response.data;
    },

    updateTriggerRule: async (id: string, input: components['schemas']['UpdateTriggerRuleDto']) => {
      const response = await apiClient.updateGitHubTriggerRule(id, input);
      if (response.error || !response.data) throw new Error('Failed to update trigger rule');
      return response.data;
    },

    deleteTriggerRule: async (id: string) => {
      const response = await apiClient.deleteGitHubTriggerRule(id);
      if (response.error) throw new Error('Failed to delete trigger rule');
    },

    triggerScan: async (repoId: string, body: { workflowId: string; branch?: string }) => {
      const response = await apiClient.triggerGitHubScan(repoId, body);
      if (response.error || !response.data) throw new Error('Failed to trigger scan');
      return response.data;
    },
  },

  analytics: {
    query: async (body: {
      filters?: { field: string; op: string; value?: unknown }[];
      search?: string;
      aggs?: { name: string; field: string; size?: number }[];
      sort?: { field: string; direction: 'asc' | 'desc' }[];
      distinct?: string;
      countDistinct?: string;
      size?: number;
      from?: number;
      useLatest?: boolean;
    }): Promise<{
      total: number;
      results: Record<string, any>[];
      aggregations?: Record<string, { key: string; count: number }[]>;
      distinctCount?: number;
    }> => {
      const response = await apiClient.queryAnalytics(body as any);
      if (response.error || !response.data) throw new Error('Analytics query failed');
      return response.data as any;
    },

    timeSeries: async (body: {
      filters?: { field: string; op: string; value?: unknown }[];
      interval?: 'day' | 'week' | 'month';
      days?: number;
      timezone?: string;
    }): Promise<{
      buckets: { date: string; severity: string; count: number }[];
    }> => {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${API_V1_URL}/analytics/time-series`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error('Time series query failed');
      return resp.json();
    },

    lifecycle: async (body: {
      hash?: string;
      hashes?: string[];
    }): Promise<{
      lifecycles: Record<string, { firstSeen: string; lastSeen: string; occurrences: number }>;
    }> => {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${API_V1_URL}/analytics/lifecycle`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error('Lifecycle query failed');
      return resp.json();
    },

    scannerSeverityCounts: async (body: {
      filters?: { field: string; op: string; value?: unknown }[];
      useLatest?: boolean;
    }): Promise<{
      buckets: { scanner: string; severity: string; count: number }[];
    }> => {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${API_V1_URL}/analytics/scanner-severity-counts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error('Scanner severity counts query failed');
      return resp.json();
    },

    prowlerChecksMetadata: async (): Promise<Record<string, ProwlerCheckMetadata>> => {
      const response = await apiClient.getAnalyticsProwlerChecksMetadata();
      if (response.error || !response.data) throw new Error('Prowler checks metadata failed');
      return response.data;
    },

    batchRunSummaries: async (runIds: string[]) => {
      const response = await apiClient.getAnalyticsBatchRunSummaries({ runIds });
      if (response.error || !response.data) throw new Error('Batch run summaries failed');
      return response.data;
    },
  },

  analyticsSettings: {
    getSettings: async () => {
      const response = await apiClient.getAnalyticsSettings();
      if (response.error || !response.data) throw new Error('Failed to fetch analytics settings');
      return response.data;
    },

    updateSettings: async (body: components['schemas']['UpdateAnalyticsSettingsDto']) => {
      const response = await apiClient.updateAnalyticsSettings(body);
      if (response.error || !response.data) throw new Error('Failed to update analytics settings');
      return response.data;
    },

    getStorageUsage: async () => {
      const response = await apiClient.getAnalyticsStorageUsage();
      if (response.error || !response.data) throw new Error('Failed to fetch storage usage');
      return response.data;
    },

    purgeData: async () => {
      const response = await apiClient.purgeAnalyticsData();
      if (response.error || !response.data) throw new Error('Failed to purge analytics data');
      return response.data;
    },
  },
};

export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeaders();
}

export default api;
