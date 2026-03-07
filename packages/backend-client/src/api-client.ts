import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components, operations } from './client';

export interface ClientConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  middleware?: Middleware | Middleware[];
}

type ClientResponse<T> = {
  data?: T;
  error?: never;
};

type CreateWorkflowPayload = components['schemas']['CreateWorkflowRequestDto'];
type UpdateWorkflowPayload = components['schemas']['UpdateWorkflowRequestDto'];
type UpdateWorkflowMetadataPayload = components['schemas']['UpdateWorkflowMetadataDto'];
type RunWorkflowPayload = components['schemas']['RunWorkflowRequestDto'];
type CreateSecretPayload = components['schemas']['CreateSecretDto'];
type RotateSecretPayload = components['schemas']['RotateSecretDto'];
type UpdateSecretPayload = components['schemas']['UpdateSecretDto'];
type UpsertProviderConfigPayload = components['schemas']['UpsertProviderConfigDto'];
type StartOAuthPayload = components['schemas']['StartOAuthDto'];
type CompleteOAuthPayload = components['schemas']['CompleteOAuthDto'];
type RefreshConnectionPayload = Record<string, never>;
type DisconnectConnectionPayload = Record<string, never>;
type ArtifactDestination = 'run' | 'library';
type CreateSchedulePayload = components['schemas']['CreateScheduleRequestDto'];
type UpdateSchedulePayload = components['schemas']['UpdateScheduleRequestDto'];
type ScheduleStatus = 'active' | 'paused' | 'error';
type CreateApiKeyPayload = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyPayload = components['schemas']['UpdateApiKeyDto'];
type CreateAsmDomainPayload = components['schemas']['CreateDomainDto'];
type UpdateAsmDomainPayload = components['schemas']['UpdateDomainDto'];
type TriggerCloudSyncPayload = components['schemas']['TriggerSyncDto'];
type CreateSyncRunPayload = components['schemas']['CreateSyncRunRequestDto'];
type ReconcileAssetsPayload = components['schemas']['ReconcileAssetsRequestDto'];
type PersistSyncRunScopesPayload = components['schemas']['PersistSyncRunScopesRequestDto'];
type MarkStaleAssetsPayload = components['schemas']['MarkStaleAssetsRequestDto'];
type UpdateSyncRunStatusPayload = components['schemas']['UpdateSyncRunStatusRequestDto'];
type UpdateOnboardingPreferencesPayload = components['schemas']['UpdateOnboardingPreferencesDto'];
type AnalyticsQueryPayload = components['schemas']['AnalyticsQueryRequestDto'];
type DiscoveryInputPayload = components['schemas']['DiscoveryInputDto'];
type GroupDiscoveryInputPayload = components['schemas']['GroupDiscoveryInputDto'];
type ResolvePortsPayload = components['schemas']['ResolvePortsRequestDto'];
type BatchRunSummariesPayload = components['schemas']['BatchRunSummariesRequestDto'];
type PrepareRunPayload = components['schemas']['PrepareRunRequestDto'];
type EnsureAnalyticsTenantPayload = components['schemas']['EnsureTenantRequestDto'];
type GenerateMcpTokenPayload = components['schemas']['GenerateMcpTokenRequestDto'];
type RegisterComponentToolPayload = components['schemas']['RegisterComponentToolInput'];
type RegisterMcpServerPayload = components['schemas']['RegisterMcpServerInput'];
type CleanupMcpRunPayload = components['schemas']['CleanupRunRequestDto'];
type ToolsReadyPayload = components['schemas']['ToolsReadyRequestDto'];
type RegisterGroupServerPayload = components['schemas']['RegisterGroupServerRequestDto'];
type InstantiateWorkflowTemplatePayload =
  components['schemas']['InstantiateWorkflowTemplateRequestDto'];
type WorkflowRunTerminalQuery =
  operations['WorkflowsController_terminalChunks']['parameters']['query'];
type ToggleGitHubRepositoryScansPayload = components['schemas']['ToggleRepoScansDto'];
type SetupGitHubInstallationPayload = components['schemas']['CompleteInstallationDto'];
type CreateGitHubTriggerRulePayload = components['schemas']['CreateTriggerRuleDto'];
type UpdateGitHubTriggerRulePayload = components['schemas']['UpdateTriggerRuleDto'];
type TriggerGitHubScanPayload = components['schemas']['GitHubTriggerScanDto'];
type ListGitHubScansQuery = operations['GitHubAppController_listScanResults']['parameters']['query'];
type AppendChatInternalEventPayload = components['schemas']['AppendInternalEventDto'];
type CompleteChatRunPayload = components['schemas']['CompleteRunRequestDto'];

/**
 * ShipSec API Client
 * 
 * Type-safe client for the ShipSec backend API
 */
export class ShipSecApiClient {
  private client: ReturnType<typeof createClient<paths>>;
  private baseUrl: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:3211';
    
    this.client = createClient<paths>({
      baseUrl: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    });

    if (config.middleware) {
      const middlewares = Array.isArray(config.middleware)
        ? config.middleware
        : [config.middleware];
      for (const mw of middlewares) {
        this.client.use(mw);
      }
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  buildUrl(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return new URL(normalized, this.baseUrl).toString();
  }

  /**
   * Add middleware to the client
   */
  use(middleware: Middleware) {
    this.client.use(middleware);
  }

  // ===== Health =====
  
  async health() {
    return this.client.GET('/api/v1/health');
  }

  // ===== Onboarding =====

  async getOnboardingPreferences() {
    return this.client.GET('/api/v1/onboarding/preferences');
  }

  async updateOnboardingPreferences(body: UpdateOnboardingPreferencesPayload) {
    return this.client.PATCH('/api/v1/onboarding/preferences', {
      body,
    });
  }

  // ===== Workflows =====
  
  async listWorkflows() {
    return this.client.GET('/api/v1/workflows');
  }

  async listWorkflowSummaries() {
    return this.client.GET('/api/v1/workflows/summary');
  }

  async getWorkflow(id: string) {
    return this.client.GET('/api/v1/workflows/{id}', {
      params: { path: { id } },
    });
  }

  async getWorkflowVersion(workflowId: string, versionId: string) {
    return this.client.GET('/api/v1/workflows/{workflowId}/versions/{versionId}', {
      params: { path: { workflowId, versionId } },
    });
  }

  async getWorkflowRuntimeInputs(workflowId: string) {
    return this.client.GET('/api/v1/workflows/{id}/runtime-inputs', {
      params: { path: { id: workflowId } },
    });
  }

  async listWorkflowTemplates() {
    return this.client.GET('/api/v1/workflow-templates');
  }

  async getWorkflowTemplate(id: string) {
    return this.client.GET('/api/v1/workflow-templates/{id}', {
      params: { path: { id } },
    });
  }

  async instantiateWorkflowTemplate(
    id: string,
    body: InstantiateWorkflowTemplatePayload = {},
  ) {
    return this.client.POST('/api/v1/workflow-templates/{id}/instantiate', {
      params: { path: { id } },
      body,
    });
  }

  async listChatSessions() {
    return this.client.GET('/api/v1/chat/sessions');
  }

  async createChatSession(body: components['schemas']['CreateSessionDto'] = {}) {
    return this.client.POST('/api/v1/chat/sessions', {
      body,
    });
  }

  async updateChatSession(id: string, body: components['schemas']['UpdateSessionDto']) {
    return this.client.PATCH('/api/v1/chat/sessions/{id}', {
      params: { path: { id } },
      body,
    });
  }

  async deleteChatSession(id: string) {
    return this.client.DELETE('/api/v1/chat/sessions/{id}', {
      params: { path: { id } },
    });
  }

  async createWorkflow(workflow: CreateWorkflowPayload) {
    return this.client.POST('/api/v1/workflows', {
      body: workflow,
    });
  }

  async updateWorkflow(id: string, workflow: UpdateWorkflowPayload) {
    return this.client.PUT('/api/v1/workflows/{id}', {
      params: { path: { id } },
      body: workflow,
    });
  }

  async updateWorkflowMetadata(id: string, metadata: UpdateWorkflowMetadataPayload) {
    return this.client.PATCH('/api/v1/workflows/{id}/metadata', {
      params: { path: { id } },
      body: metadata,
    });
  }

  async deleteWorkflow(id: string) {
    return this.client.DELETE('/api/v1/workflows/{id}', {
      params: { path: { id } },
    });
  }

  async commitWorkflow(id: string) {
    return this.client.POST('/api/v1/workflows/{id}/commit', {
      params: { path: { id } },
    });
  }

  async runWorkflow(id: string, body?: RunWorkflowPayload) {
    const payload = (body ?? { inputs: {} }) as RunWorkflowPayload;
    return this.client.POST('/api/v1/workflows/{id}/run', {
      params: { path: { id } },
      body: payload,
    });
  }

  async prepareRunPayload(body: PrepareRunPayload) {
    return this.client.POST('/api/v1/internal/runs', {
      body,
    });
  }

  // ===== Workflow Runs =====
  
  async getWorkflowRunStatus(runId: string, temporalRunId?: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/status', {
      params: { 
        path: { runId },
        query: temporalRunId ? { temporalRunId } : {},
      },
    });
  }

  async getWorkflowRunResult(runId: string, temporalRunId?: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/result', {
      params: {
        path: { runId },
        query: temporalRunId ? { temporalRunId } : {},
      },
    });
  }

  async getWorkflowRunConfig(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/config', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunTrace(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/trace', {
      params: { path: { runId } },
    });
  }

  async getAgentParts(agentRunId: string, cursor?: string) {
    return this.client.GET('/api/v1/agents/{agentRunId}/parts', {
      params: {
        path: { agentRunId },
        query: cursor ? { cursor } : undefined,
      },
    });
  }

  async cancelWorkflowRun(runId: string, temporalRunId?: string) {
    return this.client.POST('/api/v1/workflows/runs/{runId}/cancel', {
      params: {
        path: { runId },
        ...(temporalRunId ? { query: { temporalRunId } } : {}),
      },
    });
  }

  async getRunActivity(options?: { days?: number }) {
    const queryStr = options?.days ? `?days=${options.days}` : '';
    return this.client.GET(`/api/v1/workflows/runs/activity${queryStr}` as '/api/v1/workflows/runs/activity');
  }

  async listWorkflowRuns(options?: {
    workflowId?: string;
    workflowIds?: string;
    status?: string;
    triggerType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.client.GET('/api/v1/workflows/runs', {
      params: {
        query: {
          workflowId: options?.workflowId,
          workflowIds: options?.workflowIds,
          status: options?.status,
          triggerType: options?.triggerType,
          search: options?.search,
          limit: options?.limit,
          offset: options?.offset,
        },
      },
    });
  }

  async getWorkflowRun(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunEvents(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/events', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunLogs(runId: string, options?: {
    nodeRef?: string;
    stream?: 'stdout' | 'stderr' | 'console';
    level?: 'debug' | 'info' | 'warn' | 'error';
    limit?: number;
    cursor?: string;
  }) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/logs', {
      params: {
        path: { runId },
        query: {
          nodeRef: options?.nodeRef,
          stream: options?.stream,
          level: options?.level,
          limit: options?.limit,
          cursor: options?.cursor,
        },
      },
    });
  }

  async getWorkflowRunDataFlows(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/dataflows', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunArtifacts(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/artifacts', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunTerminal(runId: string, query?: WorkflowRunTerminalQuery) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/terminal', {
      params: {
        path: { runId },
        query,
      },
    });
  }

  async listWorkflowRunChildren(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/children', {
      params: { path: { runId } },
    });
  }

  async listWorkflowRunNodeIO(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/node-io', {
      params: { path: { runId } },
    });
  }

  async getWorkflowNodeIO(runId: string, nodeRef: string, options?: { full?: boolean }) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/node-io/{nodeRef}', {
      params: {
        path: { runId, nodeRef },
        query: options?.full !== undefined ? { full: options.full } : undefined,
      },
    });
  }

  async downloadWorkflowRunArtifact(runId: string, artifactId: string): Promise<Blob> {
    const response = (await this.client.GET(
      '/api/v1/workflows/runs/{runId}/artifacts/{artifactId}/download',
      {
        params: { path: { runId, artifactId } },
        parseAs: 'blob',
      },
    )) as any;
    if (response?.error) {
      throw new Error(`Failed to download artifact: ${String(response.error)}`);
    }
    return (response?.data ?? response) as Blob;
  }

  // ===== Schedules =====

  async listSchedules(options?: { workflowId?: string; status?: ScheduleStatus }) {
    return this.client.GET('/api/v1/schedules', {
      params: {
        query: {
          workflowId: options?.workflowId,
          status: options?.status,
        },
      },
    });
  }

  async getSchedule(id: string) {
    return this.client.GET('/api/v1/schedules/{id}', {
      params: { path: { id } },
    });
  }

  async createSchedule(schedule: CreateSchedulePayload) {
    return this.client.POST('/api/v1/schedules', {
      body: schedule,
    });
  }

  async updateSchedule(id: string, schedule: UpdateSchedulePayload) {
    return this.client.PATCH('/api/v1/schedules/{id}', {
      params: { path: { id } },
      body: schedule,
    });
  }

  async deleteSchedule(id: string) {
    return this.client.DELETE('/api/v1/schedules/{id}', {
      params: { path: { id } },
    });
  }

  async pauseSchedule(id: string) {
    return this.client.POST('/api/v1/schedules/{id}/pause', {
      params: { path: { id } },
    });
  }

  async resumeSchedule(id: string) {
    return this.client.POST('/api/v1/schedules/{id}/resume', {
      params: { path: { id } },
    });
  }

  async triggerSchedule(id: string) {
    return this.client.POST('/api/v1/schedules/{id}/trigger', {
      params: { path: { id } },
    });
  }

  async listArtifacts(options?: {
    workflowId?: string;
    componentId?: string;
    destination?: ArtifactDestination;
    search?: string;
    limit?: number;
  }) {
    return this.client.GET('/api/v1/artifacts', {
      params: {
        query: {
          workflowId: options?.workflowId,
          componentId: options?.componentId,
          destination: options?.destination,
          search: options?.search,
          limit: options?.limit,
        },
      },
    });
  }

  // ===== Files =====
  
  async listFiles(limit: number = 100) {
    return this.client.GET('/api/v1/files', {
      params: {
        query: { limit },
      },
    });
  }

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    
    // Use the typed client - it will automatically apply middleware (including auth headers)
    // For multipart/form-data, openapi-fetch accepts FormData directly
    return this.client.POST('/api/v1/files/upload', {
      body: formData as any, // Type assertion needed as generated types expect { file?: string } but FormData works at runtime
      // openapi-fetch will automatically set Content-Type for FormData
    });
  }

  async getFileMetadata(id: string) {
    return this.client.GET('/api/v1/files/{id}', {
      params: { path: { id } },
    });
  }

  async downloadFile(id: string): Promise<Blob> {
    // Use the typed client - it will automatically apply middleware (including auth headers)
    // For blob responses, openapi-fetch returns the blob directly or in a response object
    const response = await this.client.GET('/api/v1/files/{id}/download', {
      params: { path: { id } },
      parseAs: 'blob', // Request blob response for binary data
    }) as any; // Type assertion needed as parseAs: 'blob' changes the response type
    
    // Handle both response.data and direct blob response
    if (response?.error) {
      throw new Error(`Failed to download file: ${String(response.error)}`);
    }
    
    return (response?.data ?? response) as Blob;
  }

  async deleteFile(id: string) {
    return this.client.DELETE('/api/v1/files/{id}', {
      params: { path: { id } },
    });
  }

  // ===== Components =====
  
  async listComponents() {
    return this.client.GET('/api/v1/components');
  }

  async getComponent(id: string) {
    return this.client.GET('/api/v1/components/{id}', {
      params: { path: { id } },
    });
  }

  async resolveComponentPorts(id: string, body: ResolvePortsPayload) {
    return this.client.POST('/api/v1/components/{id}/resolve-ports', {
      params: { path: { id } },
      body,
    });
  }

  // ===== Secrets =====

  async listSecrets() {
    return this.client.GET('/api/v1/secrets');
  }

  async getSecret(id: string) {
    return this.client.GET('/api/v1/secrets/{id}', {
      params: { path: { id } },
    });
  }

  async getSecretValue(id: string, version?: number) {
    return this.client.GET('/api/v1/secrets/{id}/value', {
      params: {
        path: { id },
        query: version !== undefined ? { version } : undefined,
      },
    });
  }

  async createSecret(secret: CreateSecretPayload) {
    return this.client.POST('/api/v1/secrets', {
      body: secret,
    });
  }

  async rotateSecret(id: string, payload: RotateSecretPayload) {
    return this.client.PUT('/api/v1/secrets/{id}/rotate', {
      params: { path: { id } },
      body: payload,
    });
  }

  async updateSecret(id: string, payload: UpdateSecretPayload) {
    return this.client.PATCH('/api/v1/secrets/{id}', {
      params: { path: { id } },
      body: payload,
    });
  }

  async deleteSecret(id: string) {
    return this.client.DELETE('/api/v1/secrets/{id}', {
      params: { path: { id } },
    });
  }

  // ===== API Keys =====

  async listApiKeys(options?: { limit?: number; offset?: number; isActive?: boolean }) {
    return this.client.GET('/api/v1/api-keys', {
      params: {
        query: {
          limit: options?.limit?.toString(), // API expects string for some reason? No, schema says regex string or transformed number. Let's pass as is if typed correctly or string. DTO schema accepts string.
          offset: options?.offset?.toString(),
          isActive: options?.isActive === undefined ? undefined : (options.isActive ? 'true' : 'false'),
        },
      },
    });
  }

  async getApiKey(id: string) {
    return this.client.GET('/api/v1/api-keys/{id}', {
      params: { path: { id } },
    });
  }

  async createApiKey(apiKey: CreateApiKeyPayload) {
    return this.client.POST('/api/v1/api-keys', {
      body: apiKey,
    });
  }

  async updateApiKey(id: string, apiKey: UpdateApiKeyPayload) {
    return this.client.PATCH('/api/v1/api-keys/{id}', {
      params: { path: { id } },
      body: apiKey,
    });
  }

  async revokeApiKey(id: string) {
    return this.client.POST('/api/v1/api-keys/{id}/revoke', {
      params: { path: { id } },
    });
  }

  async deleteApiKey(id: string) {
    return this.client.DELETE('/api/v1/api-keys/{id}', {
      params: { path: { id } },
    });
  }

  // ===== Integrations =====

  async listIntegrationProviders() {
    return this.client.GET('/api/v1/integrations/providers');
  }

  async getIntegrationProviderConfiguration(provider: string) {
    return this.client.GET('/api/v1/integrations/providers/{provider}/config', {
      params: { path: { provider } },
    });
  }

  async upsertIntegrationProviderConfiguration(
    provider: string,
    payload: UpsertProviderConfigPayload,
  ) {
    return this.client.PUT('/api/v1/integrations/providers/{provider}/config', {
      params: { path: { provider } },
      body: payload,
    });
  }

  async deleteIntegrationProviderConfiguration(provider: string) {
    return this.client.DELETE('/api/v1/integrations/providers/{provider}/config', {
      params: { path: { provider } },
    });
  }

  async listIntegrationConnections(userId: string) {
    return this.client.GET('/api/v1/integrations/connections', {
      params: {
        query: { userId },
      },
    });
  }

  async startIntegrationOAuth(provider: string, payload: StartOAuthPayload) {
    return this.client.POST('/api/v1/integrations/{provider}/start', {
      params: { path: { provider } },
      body: payload,
    });
  }

  async completeIntegrationOAuth(provider: string, payload: CompleteOAuthPayload) {
    return this.client.POST('/api/v1/integrations/{provider}/exchange', {
      params: { path: { provider } },
      body: payload,
    });
  }

  async refreshIntegrationConnection(id: string, _payload?: RefreshConnectionPayload) {
    return this.client.POST('/api/v1/integrations/connections/{id}/refresh', {
      params: { path: { id } },
    });
  }

  async disconnectIntegrationConnection(id: string, _payload?: DisconnectConnectionPayload) {
    return this.client.DELETE('/api/v1/integrations/connections/{id}', {
      params: { path: { id } },
    });
  }

  async listOrgIntegrationConnections(provider?: string) {
    if (provider) {
      return this.client.GET('/api/v1/integrations/org/connections', {
        params: {
          query: { provider },
        },
      });
    }

    return this.client.GET('/api/v1/integrations/org/connections', {});
  }

  async getIntegrationCatalog() {
    return this.client.GET('/api/v1/integrations/catalog');
  }

  async getIntegrationConnectionToken(id: string, organizationId: string) {
    return this.client.POST('/api/v1/integrations/connections/{id}/token', {
      params: { path: { id }, header: { 'x-organization-id': organizationId } },
    });
  }

  async getIntegrationConnectionCredentials(id: string, organizationId: string) {
    return this.client.POST('/api/v1/integrations/connections/{id}/credentials', {
      params: { path: { id }, header: { 'x-organization-id': organizationId } },
    });
  }

  async getAwsSetupInfo() {
    return this.client.GET('/api/v1/integrations/aws/setup-info');
  }

  async createAwsIntegrationConnection(
    body: components['schemas']['CreateAwsConnectionDto'],
  ) {
    return this.client.POST('/api/v1/integrations/aws/connections', {
      body,
    });
  }

  async validateAwsIntegrationConnection(id: string) {
    return this.client.POST('/api/v1/integrations/aws/connections/{id}/validate', {
      params: { path: { id } },
    });
  }

  async discoverAwsOrganizationAccounts(id: string) {
    return this.client.POST('/api/v1/integrations/aws/connections/{id}/discover-org', {
      params: { path: { id } },
    });
  }

  async createSlackWebhookIntegrationConnection(
    body: components['schemas']['CreateSlackWebhookConnectionDto'],
  ) {
    return this.client.POST('/api/v1/integrations/slack/connections', {
      body,
    });
  }

  async testSlackIntegrationConnection(id: string) {
    return this.client.POST('/api/v1/integrations/slack/connections/{id}/test', {
      params: { path: { id } },
    });
  }

  // ===== ASM =====

  async listAsmDomains(options?: { limit?: number; offset?: number }) {
    return this.client.GET('/api/v1/asm/domains', {
      params: {
        query: {
          limit: options?.limit,
          offset: options?.offset,
        },
      },
    });
  }

  async getAsmDomain(id: string) {
    return this.client.GET('/api/v1/asm/domains/{id}', {
      params: { path: { id } },
    });
  }

  async createAsmDomain(body: CreateAsmDomainPayload) {
    return this.client.POST('/api/v1/asm/domains', {
      body,
    });
  }

  async updateAsmDomain(id: string, body: UpdateAsmDomainPayload) {
    return this.client.PATCH('/api/v1/asm/domains/{id}', {
      params: { path: { id } },
      body,
    });
  }

  async deleteAsmDomain(id: string) {
    return this.client.DELETE('/api/v1/asm/domains/{id}', {
      params: { path: { id } },
    });
  }

  async triggerAsmDomainScan(id: string, body?: { templateSlug?: string }) {
    return this.client.POST('/api/v1/asm/domains/{id}/scan', {
      params: { path: { id } },
      body: {
        templateSlug: body?.templateSlug ?? 'sys-attack-surface-recon',
      },
    });
  }

  async listAsmScans(options?: {
    limit?: number;
    offset?: number;
    status?: 'running' | 'completed' | 'failed' | 'timed_out';
    domainId?: string;
  }) {
    return this.client.GET('/api/v1/asm/scans', {
      params: {
        query: {
          limit: options?.limit,
          offset: options?.offset,
          status: options?.status,
          domainId: options?.domainId,
        },
      },
    });
  }

  async getAsmStats() {
    return this.client.GET('/api/v1/asm/stats');
  }

  // ===== Asset Discovery =====

  async listCloudAssets(options?: {
    limit?: number;
    offset?: number;
    assetType?: string;
    region?: string;
    status?: 'active' | 'stale' | 'removed';
    search?: string;
    sortBy?: 'name' | 'lastSeenAt' | 'firstDiscoveredAt';
    sortOrder?: 'asc' | 'desc';
  }) {
    return this.client.GET('/api/v1/asset-discovery/assets', {
      params: {
        query: {
          limit: options?.limit,
          offset: options?.offset,
          assetType: options?.assetType,
          region: options?.region,
          status: options?.status,
          search: options?.search,
          sortBy: options?.sortBy,
          sortOrder: options?.sortOrder,
        },
      },
    });
  }

  async getCloudAssetSummary() {
    return this.client.GET('/api/v1/asset-discovery/assets/summary');
  }

  async getCloudAsset(id: string) {
    return this.client.GET('/api/v1/asset-discovery/assets/{id}', {
      params: { path: { id } },
    });
  }

  async triggerCloudSync(body: TriggerCloudSyncPayload) {
    return this.client.POST('/api/v1/asset-discovery/assets/sync', {
      body,
    });
  }

  async listCloudSyncRuns(options?: { limit?: number; offset?: number }) {
    return this.client.GET('/api/v1/asset-discovery/sync-runs', {
      params: {
        query: {
          limit: options?.limit,
          offset: options?.offset,
        },
      },
    });
  }

  async getCloudSyncRun(id: string) {
    return this.client.GET('/api/v1/asset-discovery/sync-runs/{id}', {
      params: { path: { id } },
    });
  }

  async createCloudSyncRun(organizationId: string, body: CreateSyncRunPayload) {
    return this.client.POST('/api/v1/asset-discovery/internal/sync-runs', {
      params: { header: { 'x-organization-id': organizationId } },
      body,
    });
  }

  async reconcileCloudAssets(organizationId: string, body: ReconcileAssetsPayload) {
    return this.client.POST('/api/v1/asset-discovery/internal/assets/reconcile', {
      params: { header: { 'x-organization-id': organizationId } },
      body,
    });
  }

  async persistCloudSyncRunScopes(id: string, body: PersistSyncRunScopesPayload) {
    return this.client.POST('/api/v1/asset-discovery/internal/sync-runs/{id}/scopes', {
      params: { path: { id } },
      body,
    });
  }

  async markCloudAssetsStale(organizationId: string, body: MarkStaleAssetsPayload) {
    return this.client.POST('/api/v1/asset-discovery/internal/assets/mark-stale', {
      params: { header: { 'x-organization-id': organizationId } },
      body,
    });
  }

  async updateCloudSyncRunStatus(id: string, body: UpdateSyncRunStatusPayload) {
    return this.client.POST('/api/v1/asset-discovery/internal/sync-runs/{id}/status', {
      params: { path: { id } },
      body,
    });
  }

  // ===== Analytics =====

  async queryAnalytics(body: AnalyticsQueryPayload) {
    return this.client.POST('/api/v1/analytics/query', {
      body,
    });
  }

  async getAnalyticsProwlerChecksMetadata() {
    return this.client.GET('/api/v1/analytics/prowler-checks-metadata');
  }

  async ensureAnalyticsTenant(body: EnsureAnalyticsTenantPayload, internalToken: string) {
    return this.client.POST('/api/v1/analytics/ensure-tenant', {
      params: {
        header: { 'x-internal-token': internalToken },
      },
      body,
    });
  }

  async getAnalyticsBatchRunSummaries(body: BatchRunSummariesPayload) {
    return this.client.POST('/api/v1/analytics/batch-run-summaries', {
      body,
    });
  }

  // ===== Audit =====

  async listAuditLogs(options?: operations['AuditLogsController_list']['parameters']['query']) {
    return this.client.GET('/api/v1/audit-logs', {
      params: {
        query: options,
      },
    });
  }

  // ===== Billing =====

  async getBillingUsage() {
    return this.client.GET('/api/v1/billing/usage');
  }

  async listSubscriptionPlans() {
    return this.client.GET('/api/v1/billing/plans');
  }

  async getLiteLLMVirtualKey(
    organizationId: string,
  ): Promise<ClientResponse<components['schemas']['LiteLLMKeyResponseDto']>> {
    return this.client.GET('/api/v1/internal/billing/litellm-key', {
      params: {
        header: { 'x-organization-id': organizationId },
      },
    });
  }

  // ===== MCP Discovery =====

  async discoverMcpTools(body: DiscoveryInputPayload) {
    return this.client.POST('/api/v1/mcp/discover', {
      body,
    });
  }

  async getMcpDiscoveryStatus(workflowId: string) {
    return this.client.GET('/api/v1/mcp/discover/{workflowId}', {
      params: { path: { workflowId } },
    });
  }

  async discoverMcpGroupTools(body: GroupDiscoveryInputPayload) {
    return this.client.POST('/api/v1/mcp/discover-group', {
      body,
    });
  }

  async getMcpGroupDiscoveryStatus(workflowId: string) {
    return this.client.GET('/api/v1/mcp/discover-group/{workflowId}', {
      params: { path: { workflowId } },
    });
  }

  // ===== MCP Servers =====

  async listMcpServers(groupId?: string) {
    if (groupId) {
      return this.client.GET('/api/v1/mcp-servers', {
        params: {
          query: { groupId },
        },
      });
    }

    return this.client.GET('/api/v1/mcp-servers', {});
  }

  async listEnabledMcpServers(groupId?: string) {
    if (groupId) {
      return this.client.GET('/api/v1/mcp-servers/enabled', {
        params: {
          query: { groupId },
        },
      });
    }

    return this.client.GET('/api/v1/mcp-servers/enabled', {});
  }

  async listMcpTools() {
    return this.client.GET('/api/v1/mcp-servers/tools');
  }

  async listMcpServerHealth() {
    return this.client.GET('/api/v1/mcp-servers/health');
  }

  async getMcpServer(id: string) {
    return this.client.GET('/api/v1/mcp-servers/{id}', {
      params: { path: { id } },
    });
  }

  async createMcpServer(body: components['schemas']['CreateMcpServerDto']) {
    return this.client.POST('/api/v1/mcp-servers', {
      body,
    });
  }

  async updateMcpServer(id: string, body: components['schemas']['UpdateMcpServerDto']) {
    return this.client.PATCH('/api/v1/mcp-servers/{id}', {
      params: { path: { id } },
      body,
    });
  }

  async deleteMcpServer(id: string) {
    return this.client.DELETE('/api/v1/mcp-servers/{id}', {
      params: { path: { id } },
    });
  }

  async listMcpServerTools(id: string) {
    return this.client.GET('/api/v1/mcp-servers/{id}/tools', {
      params: { path: { id } },
    });
  }

  async toggleMcpServer(id: string) {
    return this.client.POST('/api/v1/mcp-servers/{id}/toggle', {
      params: { path: { id } },
    });
  }

  async testMcpServerConnection(id: string) {
    return this.client.POST('/api/v1/mcp-servers/{id}/test', {
      params: { path: { id } },
    });
  }

  async toggleMcpServerTool(serverId: string, toolId: string) {
    return this.client.POST('/api/v1/mcp-servers/{serverId}/tools/{toolId}/toggle', {
      params: { path: { serverId, toolId } },
    });
  }

  async resolveMcpServer(id: string) {
    return this.client.GET('/api/v1/mcp-servers/{id}/resolve', {
      params: { path: { id } },
    });
  }

  async generateMcpGatewayToken(body: GenerateMcpTokenPayload) {
    return this.client.POST('/api/v1/internal/mcp/generate-token', {
      body,
    });
  }

  async registerInternalComponentTool(body: RegisterComponentToolPayload) {
    return this.client.POST('/api/v1/internal/mcp/register-component', {
      body,
    });
  }

  async registerInternalMcpServer(body: RegisterMcpServerPayload) {
    return this.client.POST('/api/v1/internal/mcp/register-mcp-server', {
      body,
    });
  }

  async cleanupInternalMcpRun(body: CleanupMcpRunPayload) {
    return this.client.POST('/api/v1/internal/mcp/cleanup', {
      body,
    });
  }

  async areInternalMcpToolsReady(body: ToolsReadyPayload) {
    return this.client.POST('/api/v1/internal/mcp/tools-ready', {
      body,
    });
  }

  async registerInternalGroupServer(body: RegisterGroupServerPayload) {
    return this.client.POST('/api/v1/internal/mcp/register-group-server', {
      body,
    });
  }

  // ===== MCP Groups =====

  async listMcpGroups(options?: { enabled?: boolean; includeServers?: boolean }) {
    return this.client.GET('/api/v1/mcp-groups', {
      params: {
        query: {
          enabled: options?.enabled,
          includeServers: options?.includeServers,
        },
      },
    });
  }

  async listMcpGroupTemplates() {
    return this.client.GET('/api/v1/mcp-groups/templates');
  }

  async getMcpGroupBySlug(slug: string) {
    return this.client.GET('/api/v1/mcp-groups/slug/{slug}', {
      params: { path: { slug } },
    });
  }

  async getMcpGroup(id: string) {
    return this.client.GET('/api/v1/mcp-groups/{id}', {
      params: { path: { id } },
    });
  }

  async createMcpGroup(body: components['schemas']['CreateMcpGroupDto']) {
    return this.client.POST('/api/v1/mcp-groups', {
      body,
    });
  }

  async updateMcpGroup(id: string, body: components['schemas']['UpdateMcpGroupDto']) {
    return this.client.PATCH('/api/v1/mcp-groups/{id}', {
      params: { path: { id } },
      body,
    });
  }

  async deleteMcpGroup(id: string) {
    return this.client.DELETE('/api/v1/mcp-groups/{id}', {
      params: { path: { id } },
    });
  }

  async listMcpGroupServers(id: string) {
    return this.client.GET('/api/v1/mcp-groups/{id}/servers', {
      params: { path: { id } },
    });
  }

  async addMcpServerToGroup(id: string, body: components['schemas']['AddServerToGroupDto']) {
    return this.client.POST('/api/v1/mcp-groups/{id}/servers', {
      params: { path: { id } },
      body,
    });
  }

  async updateMcpServerInGroup(
    id: string,
    serverId: string,
    body: components['schemas']['UpdateServerInGroupDto'],
  ) {
    return this.client.PATCH('/api/v1/mcp-groups/{id}/servers/{serverId}', {
      params: { path: { id, serverId } },
      body,
    });
  }

  async removeMcpServerFromGroup(id: string, serverId: string) {
    return this.client.DELETE('/api/v1/mcp-groups/{id}/servers/{serverId}', {
      params: { path: { id, serverId } },
    });
  }

  async syncMcpGroupTemplates() {
    return this.client.POST('/api/v1/mcp-groups/sync-templates');
  }

  async importMcpGroupTemplate(
    slug: string,
    body?: components['schemas']['ImportTemplateRequestDto'],
  ) {
    return this.client.POST('/api/v1/mcp-groups/templates/{slug}/import', {
      params: { path: { slug } },
      body: body ?? {},
    });
  }

  // ===== Human Inputs =====

  async listHumanInputs(options?: {
    status?: 'pending' | 'resolved' | 'expired' | 'cancelled';
    inputType?: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
    workflowId?: string;
    runId?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.client.GET('/api/v1/human-inputs', {
      params: {
        query: options,
      },
    });
  }

  async getHumanInput(id: string) {
    return this.client.GET('/api/v1/human-inputs/{id}', {
      params: { path: { id } },
    });
  }

  async resolveHumanInput(id: string, payload: components['schemas']['ResolveHumanInputDto']) {
    return this.client.POST('/api/v1/human-inputs/{id}/resolve', {
      params: { path: { id } },
      body: payload,
    });
  }

  async resolveHumanInputByToken(
    token: string, 
    payload: components['schemas']['ResolveByTokenDto']
  ) {
    return this.client.POST('/api/v1/human-inputs/resolve/{token}', {
      params: { path: { token } },
      body: payload,
    });
  }

  // ===== Webhook Configurations =====

  async listWebhookConfigurations() {
    return this.client.GET('/api/v1/webhooks/configurations');
  }

  async getWebhookConfiguration(id: string) {
    return this.client.GET('/api/v1/webhooks/configurations/{id}', {
      params: { path: { id } },
    });
  }

  async createWebhookConfiguration(payload: components['schemas']['CreateWebhookRequestDto']) {
    return this.client.POST('/api/v1/webhooks/configurations', {
      body: payload,
    });
  }

  async updateWebhookConfiguration(id: string, payload: components['schemas']['UpdateWebhookRequestDto']) {
    return this.client.PUT('/api/v1/webhooks/configurations/{id}', {
      params: { path: { id } },
      body: payload,
    });
  }

  async testWebhookScript(payload: components['schemas']['TestWebhookScriptRequestDto']) {
    return this.client.POST('/api/v1/webhooks/configurations/test-script', {
      body: payload,
    });
  }

  async deleteWebhookConfiguration(id: string) {
    return this.client.DELETE('/api/v1/webhooks/configurations/{id}', {
      params: { path: { id } },
      });
  }

  async listDeliveries(id: string) {
    return this.client.GET('/api/v1/webhooks/configurations/{id}/deliveries', {
      params: { path: { id } },
    });
  }

  async regenerateWebhookPath(id: string) {
    return this.client.POST('/api/v1/webhooks/configurations/{id}/regenerate-path', {
      params: { path: { id } },
    });
  }

  // ===== GitHub =====

  async getGitHubStatus() {
    return this.client.GET('/api/v1/github/status');
  }

  async listGitHubInstallations() {
    return this.client.GET('/api/v1/github/installations');
  }

  async listGitHubRepositories() {
    return this.client.GET('/api/v1/github/repos');
  }

  async listGitHubBranches(id: string) {
    return this.client.GET('/api/v1/github/repos/{id}/branches', {
      params: { path: { id } },
    });
  }

  async toggleGitHubRepositoryScans(id: string, body: ToggleGitHubRepositoryScansPayload) {
    return this.client.PATCH('/api/v1/github/repos/{id}/scans', {
      params: { path: { id } },
      body,
    });
  }

  async setupGitHubInstallation(body: SetupGitHubInstallationPayload) {
    return this.client.POST('/api/v1/github/installations/setup', {
      body,
    });
  }

  async syncGitHubRepositories() {
    return this.client.POST('/api/v1/github/repos/sync');
  }

  async listGitHubTriggerRules() {
    return this.client.GET('/api/v1/github/triggers');
  }

  async createGitHubTriggerRule(body: CreateGitHubTriggerRulePayload) {
    return this.client.POST('/api/v1/github/triggers', {
      body,
    });
  }

  async updateGitHubTriggerRule(id: string, body: UpdateGitHubTriggerRulePayload) {
    return this.client.PATCH('/api/v1/github/triggers/{id}', {
      params: { path: { id } },
      body,
    });
  }

  async deleteGitHubTriggerRule(id: string) {
    return this.client.DELETE('/api/v1/github/triggers/{id}', {
      params: { path: { id } },
    });
  }

  async listGitHubScans(query?: ListGitHubScansQuery) {
    if (query) {
      return this.client.GET('/api/v1/github/scans', {
        params: { query },
      });
    }

    return this.client.GET('/api/v1/github/scans');
  }

  async getGitHubScan(id: string) {
    return this.client.GET('/api/v1/github/scans/{id}', {
      params: { path: { id } },
    });
  }

  async triggerGitHubScan(id: string, body: TriggerGitHubScanPayload) {
    return this.client.POST('/api/v1/github/repos/{id}/scan', {
      params: { path: { id } },
      body,
    });
  }

  // ===== Chat Internal =====

  async appendChatInternalEvent(id: string, body: AppendChatInternalEventPayload) {
    return this.client.POST('/api/v1/chat/sessions/{id}/internal/events', {
      params: { path: { id } },
      body,
    });
  }

  async completeChatRun(id: string, body: CompleteChatRunPayload) {
    return this.client.POST('/api/v1/chat/sessions/{id}/internal/run-completion', {
      params: { path: { id } },
      body,
    });
  }
}

/**
 * Create a new ShipSec API client instance
 */
export function createShipSecClient(config?: ClientConfig) {
  return new ShipSecApiClient(config);
}

// Export types for consumers
export type * from './client';
