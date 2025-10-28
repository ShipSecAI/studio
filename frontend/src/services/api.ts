import { createShipSecClient, type components } from '@shipsec/backend-client'
import { useAuthStore } from '@/store/authStore'
import { getFreshClerkToken } from '@/utils/clerk-token'
import type { ZodType } from 'zod'
import {
  IntegrationConnectionSchema,
  IntegrationProviderConfigurationSchema,
  IntegrationProviderSchema,
  OAuthStartResponseSchema,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationProviderConfiguration,
  type OAuthStartResponse,
} from '@/schemas/integration'

// Direct type imports from backend client
type WorkflowResponseDto = components['schemas']['WorkflowResponseDto']
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto']
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto']
type SecretSummaryResponse = components['schemas']['SecretSummaryResponse']
type SecretValueResponse = components['schemas']['SecretValueResponse']
type CreateSecretDto = components['schemas']['CreateSecretDto']
type RotateSecretDto = components['schemas']['RotateSecretDto']
type UpdateSecretDto = components['schemas']['UpdateSecretDto']

/**
 * API Client Configuration
 */
type RuntimeImportMeta = ImportMeta & {
  env?: Record<string, string | undefined>
}

function resolveApiBaseUrl() {
  const metaEnv = (import.meta as RuntimeImportMeta).env
  if (metaEnv?.VITE_API_URL && metaEnv.VITE_API_URL.trim().length > 0) {
    return metaEnv.VITE_API_URL
  }

  if (typeof process !== 'undefined') {
    const nodeEnv = (process.env ?? {}).VITE_API_URL
    if (nodeEnv && nodeEnv.trim().length > 0) {
      return nodeEnv
    }
  }

  return 'http://localhost:3211'
}

export const API_BASE_URL = resolveApiBaseUrl()

// Helper function to get auth headers (reused by middleware and file operations)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const storeState = useAuthStore.getState()
  let token = storeState.token
  const organizationId = storeState.organizationId

  // For Clerk auth, always fetch a fresh token on-demand to prevent expiration issues
  // This ensures we never use a stale/expired token
  if (storeState.provider === 'clerk') {
    try {
      const freshToken = await getFreshClerkToken()
      if (freshToken) {
        token = freshToken
        // Update store with fresh token so it's available for next time
        storeState.setToken(freshToken)
      } else {
        // If we can't get a fresh token, fall back to store token
        console.warn('[API] Failed to get fresh Clerk token, using store token');
      }
    } catch (error) {
      console.error('[API] Error fetching fresh Clerk token:', error);
      // Fall back to store token if fresh token fetch fails
    }
  }

  const headers: Record<string, string> = {}

  if (token && token.trim().length > 0) {
    const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`
    headers['Authorization'] = headerValue
  } else {
    console.warn('[API] No token available for request');
  }

  if (organizationId && organizationId.trim().length > 0) {
    headers['X-Organization-Id'] = organizationId
  }

  return headers
}

// Create type-safe API client
const apiClient = createShipSecClient({
  baseUrl: API_BASE_URL,
  middleware: {
    async onRequest({ request }) {
      const headers = await getAuthHeaders()

      // Apply auth headers to the request
      if (headers['Authorization']) {
        request.headers.set('Authorization', headers['Authorization'])
      }
      if (headers['X-Organization-Id']) {
        request.headers.set('X-Organization-Id', headers['X-Organization-Id'])
      }

      if (!request.headers.has('Content-Type')) {
        request.headers.set('Content-Type', 'application/json')
      }

      return request
    },
  },
})

function buildApiPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

async function extractErrorMessage(response: Response, fallback: string) {
  try {
    const text = await response.text()
    if (!text) {
      return fallback
    }
    const data = JSON.parse(text)
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string') {
        return data.message
      }
      if (Array.isArray(data.message)) {
        return data.message.join(', ')
      }
      if (typeof data.error === 'string') {
        return data.error
      }
    }
    return text || fallback
  } catch {
    return fallback
  }
}

async function fetchWithAuth(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const authHeaders = await getAuthHeaders()

  if (authHeaders['Authorization']) {
    headers.set('Authorization', authHeaders['Authorization'])
  }
  if (authHeaders['X-Organization-Id']) {
    headers.set('X-Organization-Id', authHeaders['X-Organization-Id'])
  }

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(`${API_BASE_URL}/api/v1${buildApiPath(path)}`, {
    ...init,
    headers,
  })
}

async function fetchJson<T>(
  path: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchWithAuth(path, init)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, response.statusText))
  }
  const data = await response.json()
  return schema.parse(data)
}

async function fetchVoid(path: string, init: RequestInit = {}) {
  const response = await fetchWithAuth(path, init)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, response.statusText))
  }
}

interface StartOAuthPayload {
  userId: string
  redirectUri: string
  scopes?: string[]
}

interface CompleteOAuthPayload extends StartOAuthPayload {
  state: string
  code: string
}

interface RefreshConnectionPayload {
  userId: string
}

interface UpsertProviderConfigPayload {
  clientId: string
  clientSecret?: string
}

/**
 * API Service
 * Simple wrapper around the backend API client
 */
export const api = {
  workflows: {
    list: async (): Promise<WorkflowResponseDto[]> => {
      const response = await apiClient.listWorkflows()
      if (response.error) throw new Error('Failed to fetch workflows')
      return response.data || []
    },

    get: async (id: string): Promise<WorkflowResponseDto> => {
      const response = await apiClient.getWorkflow(id)
      if (response.error) throw new Error('Failed to fetch workflow')
      if (!response.data) throw new Error('Workflow not found')
      return response.data
    },

    create: async (workflow: CreateWorkflowRequestDto): Promise<WorkflowResponseDto> => {
      const response = await apiClient.createWorkflow(workflow)
      if (response.error) throw new Error('Failed to create workflow')
      if (!response.data) throw new Error('Workflow creation failed')
      return response.data
    },

    update: async (id: string, workflow: UpdateWorkflowRequestDto): Promise<WorkflowResponseDto> => {
      const response = await apiClient.updateWorkflow(id, workflow)
      if (response.error) throw new Error('Failed to update workflow')
      if (!response.data) throw new Error('Workflow update failed')
      return response.data
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteWorkflow(id)
      if (response.error) throw new Error('Failed to delete workflow')
    },

    commit: async (id: string) => {
      const response: any = await apiClient.commitWorkflow(id)
      if (response.error) {
        const message = response.error?.message || 'Failed to commit workflow'
        throw new Error(message)
      }
      return response.data
    },

    run: async (id: string, body?: { inputs?: Record<string, unknown> }) => {
      const response: any = await apiClient.runWorkflow(id, body)
      if (response.error) {
        const message = response.error?.message || 'Failed to run workflow'
        throw new Error(message)
      }
      return response.data
    },
  },

  components: {
    list: async () => {
      const response = await apiClient.listComponents()
      if (response.error) throw new Error('Failed to fetch components')
      return response.data || []
    },

    get: async (slug: string) => {
      const response = await apiClient.getComponent(slug)
      if (response.error) throw new Error('Failed to fetch component')
      return response.data
    },
  },

  secrets: {
    list: async (): Promise<SecretSummaryResponse[]> => {
      const response = await apiClient.listSecrets()
      if (response.error) throw new Error('Failed to fetch secrets')
      return response.data || []
    },

    create: async (input: CreateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.createSecret(input)
      if (response.error) throw new Error('Failed to create secret')
      if (!response.data) throw new Error('Secret creation failed')
      return response.data
    },

    update: async (id: string, input: UpdateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.updateSecret(id, input)
      if (response.error) throw new Error('Failed to update secret')
      if (!response.data) throw new Error('Secret update failed')
      return response.data
    },

    rotate: async (id: string, input: RotateSecretDto): Promise<SecretSummaryResponse> => {
      const response = await apiClient.rotateSecret(id, input)
      if (response.error) throw new Error('Failed to rotate secret')
      if (!response.data) throw new Error('Secret rotation failed')
      return response.data
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteSecret(id)
      if (response.error) throw new Error('Failed to delete secret')
    },

    getValue: async (id: string, version?: number): Promise<SecretValueResponse> => {
      const response = await apiClient.getSecretValue(id, version)
      if (response.error) throw new Error('Failed to fetch secret value')
      if (!response.data) throw new Error('Secret value not found')
      return response.data
    },
  },

  integrations: {
    listProviders: async (): Promise<IntegrationProvider[]> => {
      return fetchJson(
        '/integrations/providers',
        IntegrationProviderSchema.array(),
      )
    },

    listConnections: async (userId: string): Promise<IntegrationConnection[]> => {
      const query = new URLSearchParams({ userId })
      return fetchJson(
        `/integrations/connections?${query.toString()}`,
        IntegrationConnectionSchema.array(),
      )
    },

    startOAuth: async (
      providerId: string,
      payload: StartOAuthPayload,
    ): Promise<OAuthStartResponse> => {
      return fetchJson(
        `/integrations/${providerId}/start`,
        OAuthStartResponseSchema,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      )
    },

    completeOAuth: async (
      providerId: string,
      payload: CompleteOAuthPayload,
    ): Promise<IntegrationConnection> => {
      return fetchJson(
        `/integrations/${providerId}/exchange`,
        IntegrationConnectionSchema,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      )
    },

    refreshConnection: async (
      id: string,
      userId: string,
    ): Promise<IntegrationConnection> => {
      const payload: RefreshConnectionPayload = { userId }
      return fetchJson(
        `/integrations/connections/${id}/refresh`,
        IntegrationConnectionSchema,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      )
    },

    disconnect: async (id: string, userId: string): Promise<void> => {
      await fetchVoid(`/integrations/connections/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ userId }),
      })
    },

    getProviderConfig: async (
      providerId: string,
    ): Promise<IntegrationProviderConfiguration> => {
      return fetchJson(
        `/integrations/providers/${providerId}/config`,
        IntegrationProviderConfigurationSchema,
      )
    },

    upsertProviderConfig: async (
      providerId: string,
      payload: UpsertProviderConfigPayload,
    ): Promise<IntegrationProviderConfiguration> => {
      return fetchJson(
        `/integrations/providers/${providerId}/config`,
        IntegrationProviderConfigurationSchema,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      )
    },

    deleteProviderConfig: async (providerId: string): Promise<void> => {
      await fetchVoid(`/integrations/providers/${providerId}/config`, {
        method: 'DELETE',
      })
    },
  },

  executions: {
    start: async (
      workflowId: string,
      inputs?: Record<string, unknown>
    ): Promise<{ executionId: string }> => {
      const payload = inputs ? { inputs } : undefined
      const response = await apiClient.runWorkflow(workflowId, payload)
      if (response.error) throw new Error('Failed to start execution')
      return { executionId: (response.data as any)?.runId || '' }
    },

    getStatus: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunStatus(executionId)
      if (response.error) throw new Error('Failed to fetch execution status')
      return response.data
    },

    getTrace: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunTrace(executionId)
      if (response.error) throw new Error('Failed to fetch execution logs')
      return response.data
    },

    getEvents: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunEvents(executionId)
      if (response.error) throw new Error('Failed to fetch events')
      return response.data || []
    },

    getDataFlows: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunDataFlows(executionId)
      if (response.error) throw new Error('Failed to fetch data flows')
      return response.data || []
    },

        stream: async (executionId: string, options?: { cursor?: string; temporalRunId?: string }): Promise<EventSource> => {
          // Use fetch-based SSE client that supports custom headers (including Authorization)
          const { FetchEventSource } = await import('@/utils/sse-client')
          
          const storeState = useAuthStore.getState()
          let token = storeState.token
          const organizationId = storeState.organizationId

          // For Clerk auth, fetch a fresh token
          if (storeState.provider === 'clerk') {
            try {
              const freshToken = await getFreshClerkToken()
              if (freshToken) {
                token = freshToken
                storeState.setToken(freshToken)
              }
            } catch (error) {
              console.error('[API] Error fetching fresh Clerk token for SSE:', error)
            }
          }

          // Build URL with query params
          const params = new URLSearchParams()
          if (options?.cursor) params.set('cursor', options.cursor)
          if (options?.temporalRunId) params.set('temporalRunId', options.temporalRunId)
          const query = params.toString()
          const url = `${API_BASE_URL}/api/v1/workflows/runs/${executionId}/stream${query ? `?${query}` : ''}`

          // Build auth headers
          const headers: Record<string, string> = {}
          if (token && token.trim().length > 0) {
            const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`
            headers['Authorization'] = headerValue
          }
          if (organizationId && organizationId.trim().length > 0) {
            headers['X-Organization-Id'] = organizationId
          }

          return new FetchEventSource(url, { headers })
        },

    cancel: async (executionId: string) => {
      const response = await apiClient.cancelWorkflowRun(executionId)
      if (response.error) throw new Error('Failed to cancel execution')
      return { success: true }
    },

    listRuns: async (options?: {
      workflowId?: string;
      status?: string;
      limit?: number;
    }) => {
      const response = await apiClient.listWorkflowRuns(options)
      if (response.error) throw new Error('Failed to fetch runs')
      return response.data || { runs: [] }
    },
  },

  files: {
    list: async () => {
      const response = await apiClient.listFiles()
      if (response.error) throw new Error('Failed to fetch files')
      return response.data
    },

    upload: async (file: File) => {
      const response = await apiClient.uploadFile(file) as any
      if (response.error) {
        const errorMessage = response.error instanceof Error 
          ? response.error.message 
          : typeof response.error === 'string'
          ? response.error
          : 'Failed to upload file'
        throw new Error(errorMessage)
      }
      return response.data
    },

    download: async (id: string) => {
      return apiClient.downloadFile(id)
    },

    delete: async (id: string) => {
      const response = await apiClient.deleteFile(id)
      if (response.error) throw new Error('Failed to delete file')
    },
  },
}

export default api
