import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './client';

export interface ClientConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
}

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
  }

  /**
   * Add middleware to the client
   */
  use(middleware: Middleware) {
    this.client.use(middleware);
  }

  // ===== Health =====
  
  async health() {
    return this.client.GET('/health');
  }

  // ===== Workflows =====
  
  async listWorkflows() {
    return this.client.GET('/workflows');
  }

  async getWorkflow(id: string) {
    return this.client.GET('/workflows/{id}', {
      params: { path: { id } },
    });
  }

  async createWorkflow(workflow: paths['/workflows']['post']['requestBody']['content']['application/json']) {
    return this.client.POST('/workflows', {
      body: workflow,
    });
  }

  async updateWorkflow(
    id: string,
    workflow: paths['/workflows/{id}']['put']['requestBody']['content']['application/json'],
  ) {
    return this.client.PUT('/workflows/{id}', {
      params: { path: { id } },
      body: workflow,
    });
  }

  async deleteWorkflow(id: string) {
    return this.client.DELETE('/workflows/{id}', {
      params: { path: { id } },
    });
  }

  async commitWorkflow(id: string) {
    return this.client.POST('/workflows/{id}/commit', {
      params: { path: { id } },
    });
  }

  async runWorkflow(id: string, body?: paths['/workflows/{id}/run']['post']['requestBody']['content']['application/json']) {
    return this.client.POST('/workflows/{id}/run', {
      params: { path: { id } },
      body,
    });
  }

  // ===== Workflow Runs =====
  
  async getWorkflowRunStatus(runId: string, temporalRunId?: string) {
    return this.client.GET('/workflows/runs/{runId}/status', {
      params: { 
        path: { runId },
        query: temporalRunId ? { temporalRunId } : {},
      },
    });
  }

  async getWorkflowRunResult(runId: string, temporalRunId?: string) {
    return this.client.GET('/workflows/runs/{runId}/result', {
      params: {
        path: { runId },
        query: temporalRunId ? { temporalRunId } : {},
      },
    });
  }

  async getWorkflowRunTrace(runId: string) {
    return this.client.GET('/workflows/runs/{runId}/trace', {
      params: { path: { runId } },
    });
  }

  async cancelWorkflowRun(runId: string, temporalRunId?: string) {
    return this.client.POST('/workflows/runs/{runId}/cancel', {
      params: { 
        path: { runId },
        query: { temporalRunId: temporalRunId || '' } as any,
      },
    });
  }

  // ===== Files =====
  
  async listFiles(limit: number = 100) {
    return this.client.GET('/files', {
      params: {
        query: { limit: limit.toString() },
      },
    });
  }

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    
    // Use fetch directly for multipart/form-data uploads
    const response = await fetch(`${this.baseUrl}/files/upload`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      return { error: new Error(`Upload failed: ${response.statusText}`), data: undefined };
    }
    
    const data = await response.json();
    return { data, error: undefined };
  }

  async getFileMetadata(id: string) {
    return this.client.GET('/files/{id}', {
      params: { path: { id } },
    });
  }

  async downloadFile(id: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/files/${id}/download`);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return response.blob();
  }

  async deleteFile(id: string) {
    return this.client.DELETE('/files/{id}', {
      params: { path: { id } },
    });
  }

  // ===== Components =====
  
  async listComponents() {
    return this.client.GET('/components');
  }

  async getComponent(id: string) {
    return this.client.GET('/components/{id}', {
      params: { path: { id } },
    });
  }

  // ===== Secrets =====

  async listSecrets() {
    return this.client.GET('/secrets');
  }

  async getSecret(id: string) {
    return this.client.GET('/secrets/{id}', {
      params: { path: { id } },
    });
  }

  async getSecretValue(id: string, version?: number) {
    return this.client.GET('/secrets/{id}/value', {
      params: {
        path: { id },
        query: version !== undefined ? { version } : undefined,
      },
    });
  }

  async createSecret(
    secret: paths['/secrets']['post']['requestBody']['content']['application/json'],
  ) {
    return this.client.POST('/secrets', {
      body: secret,
    });
  }

  async rotateSecret(
    id: string,
    payload: paths['/secrets/{id}/rotate']['put']['requestBody']['content']['application/json'],
  ) {
    return this.client.PUT('/secrets/{id}/rotate', {
      params: { path: { id } },
      body: payload,
    });
  }

  async updateSecret(
    id: string,
    payload: paths['/secrets/{id}']['patch']['requestBody']['content']['application/json'],
  ) {
    return this.client.PATCH('/secrets/{id}', {
      params: { path: { id } },
      body: payload,
    });
  }

  async deleteSecret(id: string) {
    return this.client.DELETE('/secrets/{id}', {
      params: { path: { id } },
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
