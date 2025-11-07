import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './client';

export interface ClientConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  middleware?: Middleware | Middleware[];
}

type CreateWorkflowPayload = components['schemas']['CreateWorkflowRequestDto'];
type UpdateWorkflowPayload = components['schemas']['UpdateWorkflowRequestDto'];
type RunWorkflowPayload = components['schemas']['RunWorkflowRequestDto'];
type CreateSecretPayload = components['schemas']['CreateSecretDto'];
type RotateSecretPayload = components['schemas']['RotateSecretDto'];
type UpdateSecretPayload = components['schemas']['UpdateSecretDto'];
type UpsertProviderConfigPayload = components['schemas']['UpsertProviderConfigDto'];
type StartOAuthPayload = components['schemas']['StartOAuthDto'];
type CompleteOAuthPayload = components['schemas']['CompleteOAuthDto'];
type RefreshConnectionPayload = components['schemas']['RefreshConnectionDto'];
type DisconnectConnectionPayload = components['schemas']['DisconnectConnectionDto'];

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

  async getWorkflowRunTrace(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/trace', {
      params: { path: { runId } },
    });
  }

  async cancelWorkflowRun(runId: string, temporalRunId?: string) {
    return this.client.POST('/api/v1/workflows/runs/{runId}/cancel', {
      params: { 
        path: { runId },
        query: { temporalRunId: temporalRunId || '' } as any,
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

  async getWorkflowRunEvents(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/events', {
      params: { path: { runId } },
    });
  }

  async getWorkflowRunDataFlows(runId: string) {
    return this.client.GET('/api/v1/workflows/runs/{runId}/dataflows', {
      params: { path: { runId } },
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
}

/**
 * Create a new ShipSec API client instance
 */
export function createShipSecClient(config?: ClientConfig) {
  return new ShipSecApiClient(config);
}

// Export types for consumers
export type * from './client';
