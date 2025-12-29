import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './client';

export interface ClientConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  middleware?: Middleware | Middleware[];
}

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
type RefreshConnectionPayload = components['schemas']['RefreshConnectionDto'];
type DisconnectConnectionPayload = components['schemas']['DisconnectConnectionDto'];
type ArtifactDestination = 'run' | 'library';
type CreateSchedulePayload = components['schemas']['CreateScheduleRequestDto'];
type UpdateSchedulePayload = components['schemas']['UpdateScheduleRequestDto'];
type ScheduleStatus = 'active' | 'paused' | 'error';
type CreateApiKeyPayload = components['schemas']['CreateApiKeyDto'];
type UpdateApiKeyPayload = components['schemas']['UpdateApiKeyDto'];

/**
 * ShipSec API Client
 * 
 * Type-safe client for the ShipSec backend API
 */
export class ShipSecApiClient {
  private client: ReturnType<typeof createClient<paths>>;
  private baseUrl: string;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3211';
    
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

  // ===== Workflows =====
  
  async listWorkflows() {
    return this.client.GET('/api/v1/workflows');
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

  async cancelWorkflowRun(runId: string, temporalRunId?: string) {
    return this.client.POST('/api/v1/workflows/runs/{runId}/cancel', {
      params: {
        path: { runId },
        ...(temporalRunId ? { query: { temporalRunId } } : {}),
      },
    });
  }

  async listWorkflowRuns(options?: {
    workflowId?: string;
    status?: string;
    limit?: number;
  }) {
    return this.client.GET('/api/v1/workflows/runs', {
      params: {
        query: {
          workflowId: options?.workflowId,
          status: options?.status,
          limit: options?.limit,
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

  async downloadWorkflowRunArtifact(runId: string, artifactId: string): Promise<Blob> {
    const response = (await this.client.GET(
      '/api/v1/workflows/runs/{runId}/artifacts/{artifactId}/download',
      {
        params: { path: { runId, id: artifactId } },
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

  async refreshIntegrationConnection(id: string, payload: RefreshConnectionPayload) {
    return this.client.POST('/api/v1/integrations/connections/{id}/refresh', {
      params: { path: { id } },
      body: payload,
    });
  }

  async disconnectIntegrationConnection(id: string, payload: DisconnectConnectionPayload) {
    return this.client.DELETE('/api/v1/integrations/connections/{id}', {
      params: { path: { id } },
      body: payload,
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
}

/**
 * Create a new ShipSec API client instance
 */
export function createShipSecClient(config?: ClientConfig) {
  return new ShipSecApiClient(config);
}

// Export types for consumers
export type * from './client';
