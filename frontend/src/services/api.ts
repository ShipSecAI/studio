import { createShipSecClient, type components } from '@shipsec/backend-client'
import type {
  ArtifactDestination,
  RunArtifactsResponse,
  WorkflowSchedule,
  ScheduleStatus,
} from '@shipsec/shared'
import { useAuthStore } from '@/store/authStore'
import { getFreshClerkToken } from '@/utils/clerk-token'
// Direct type imports from backend client
type WorkflowResponseDto = components['schemas']['WorkflowResponseDto']
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto']
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto']
type SecretSummaryResponse = components['schemas']['SecretSummaryResponse']
type SecretValueResponse = components['schemas']['SecretValueResponse']
type CreateSecretDto = components['schemas']['CreateSecretDto']
type RotateSecretDto = components['schemas']['RotateSecretDto']
type UpdateSecretDto = components['schemas']['UpdateSecretDto']
type IntegrationProviderResponse = components['schemas']['IntegrationProviderResponse']
type IntegrationConnectionResponse = components['schemas']['IntegrationConnectionResponse']
type ProviderConfigurationResponse = components['schemas']['ProviderConfigurationResponse']
type OAuthStartResponseDto = components['schemas']['OAuthStartResponseDto']
type StartOAuthRequest = components['schemas']['StartOAuthDto']
type CompleteOAuthRequest = components['schemas']['CompleteOAuthDto']
type RefreshConnectionRequest = components['schemas']['RefreshConnectionDto']
type DisconnectConnectionRequest = components['schemas']['DisconnectConnectionDto']
type UpsertProviderConfigRequest = components['schemas']['UpsertProviderConfigDto']
type WorkflowVersionResponse = components['schemas']['WorkflowVersionResponseDto']
type CreateScheduleRequestDto = components['schemas']['CreateScheduleRequestDto']
type UpdateScheduleRequestDto = components['schemas']['UpdateScheduleRequestDto']
type ApiKeyResponseDto = components['schemas']['ApiKeyResponseDto']
type CreateApiKeyResponseDto = components['schemas']['CreateApiKeyResponseDto']
type CreateApiKeyDto = components['schemas']['CreateApiKeyDto']
type UpdateApiKeyDto = components['schemas']['UpdateApiKeyDto']

type TerminalChunkResponse = {
  runId: string
  cursor?: string
  chunks: Array<{
    nodeRef: string
    stream: string
    chunkIndex: number
    payload: string
    recordedAt: string
    deltaMs?: number
    origin?: string
    runnerKind?: string
  }>
}


export type IntegrationProvider = IntegrationProviderResponse
export type IntegrationConnection = IntegrationConnectionResponse
export type IntegrationProviderConfiguration = ProviderConfigurationResponse
export type OAuthStartResponse = OAuthStartResponseDto
export interface ArtifactListFilters {
  workflowId?: string
  componentId?: string
  destination?: ArtifactDestination
  search?: string
  limit?: number
}

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
  // For local auth, always use 'local-dev' org ID
  const organizationId = storeState.provider === 'local' ? 'local-dev' : storeState.organizationId

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
      }
    } catch (error) {
      // Fall back to store token if fresh token fetch fails
    }
  }

  const headers: Record<string, string> = {}

  // For local auth with admin credentials, use Basic Auth
  if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
    const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`)
    headers['Authorization'] = `Basic ${credentials}`
  } else if (token && token.trim().length > 0) {
    // Use Bearer token (for Clerk)
    const headerValue = token.startsWith('Bearer ') ? token : `Bearer ${token}`
    headers['Authorization'] = headerValue
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

async function fetchScheduleById(id: string): Promise<WorkflowSchedule> {
  const response = await apiClient.getSchedule(id)
  if (response.error) {
    throw new Error('Failed to fetch schedule')
  }
  const schedule = (response.data ?? null) as WorkflowSchedule | null
  if (!schedule) {
    throw new Error('Schedule not found')
  }
  return schedule
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

    getVersion: async (workflowId: string, versionId: string): Promise<WorkflowVersionResponse> => {
      const response = await apiClient.getWorkflowVersion(workflowId, versionId)
      if (response.error || !response.data) {
        throw new Error('Failed to fetch workflow version')
      }
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

    updateMetadata: async (
      id: string,
      metadata: { name: string; description?: string | null }
    ): Promise<WorkflowResponseDto> => {
      const response = await apiClient.updateWorkflowMetadata(id, metadata)
      if (response.error) throw new Error('Failed to update workflow metadata')
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

    resolvePorts: async (id: string, params: Record<string, unknown>) => {
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_BASE_URL}/api/v1/components/${id}/resolve-ports`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        throw new Error('Failed to resolve ports')
      }
      return await response.json()
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
      const response = await apiClient.listIntegrationProviders()
      if (response.error) throw new Error('Failed to load providers')
      return (response.data ?? []) as IntegrationProvider[]
    },

    listConnections: async (userId: string): Promise<IntegrationConnection[]> => {
      const response = await apiClient.listIntegrationConnections(userId)
      if (response.error) throw new Error('Failed to load integrations')
      return (response.data ?? []) as IntegrationConnection[]
    },

    startOAuth: async (
      providerId: string,
      payload: StartOAuthRequest,
    ): Promise<OAuthStartResponse> => {
      const response = await apiClient.startIntegrationOAuth(providerId, payload)
      if (response.error || !response.data) throw new Error('Failed to start OAuth flow')
      return response.data
    },

    completeOAuth: async (
      providerId: string,
      payload: CompleteOAuthRequest,
    ): Promise<IntegrationConnection> => {
      const response = await apiClient.completeIntegrationOAuth(providerId, payload)
      if (response.error || !response.data) throw new Error('Failed to complete OAuth exchange')
      return response.data
    },

    refreshConnection: async (
      id: string,
      userId: string,
    ): Promise<IntegrationConnection> => {
      const payload: RefreshConnectionRequest = { userId }
      const response = await apiClient.refreshIntegrationConnection(id, payload)
      if (response.error || !response.data) {
        throw new Error('Failed to refresh integration connection')
      }
      return response.data
    },

    disconnect: async (id: string, userId: string): Promise<void> => {
      const payload: DisconnectConnectionRequest = { userId }
      const response = await apiClient.disconnectIntegrationConnection(id, payload)
      if (response.error) throw new Error('Failed to disconnect integration')
    },

    getProviderConfig: async (
      providerId: string,
    ): Promise<IntegrationProviderConfiguration> => {
      const response = await apiClient.getIntegrationProviderConfiguration(providerId)
      if (response.error || !response.data) {
        throw new Error('Failed to load provider configuration')
      }
      return response.data
    },

    upsertProviderConfig: async (
      providerId: string,
      payload: UpsertProviderConfigRequest,
    ): Promise<IntegrationProviderConfiguration> => {
      const response = await apiClient.upsertIntegrationProviderConfiguration(
        providerId,
        payload,
      )
      if (response.error || !response.data) {
        throw new Error('Failed to save provider configuration')
      }
      return response.data
    },

    deleteProviderConfig: async (providerId: string): Promise<void> => {
      const response = await apiClient.deleteIntegrationProviderConfiguration(providerId)
      if (response.error) throw new Error('Failed to remove provider configuration')
    },
  },

  schedules: {
    list: async (filters?: { workflowId?: string | null; status?: ScheduleStatus }) => {
      const response = await apiClient.listSchedules({
        workflowId: filters?.workflowId ?? undefined,
        status: filters?.status,
      })
      if (response.error) throw new Error('Failed to fetch schedules')
      const payload = (response.data as { schedules?: WorkflowSchedule[] } | undefined)
      return payload?.schedules ?? []
    },

    get: async (id: string): Promise<WorkflowSchedule> => {
      return fetchScheduleById(id)
    },

    create: async (payload: CreateScheduleRequestDto): Promise<WorkflowSchedule> => {
      const response = await apiClient.createSchedule(payload)
      if (response.error) throw new Error('Failed to create schedule')
      const schedule = (response.data ?? null) as WorkflowSchedule | null
      if (!schedule) {
        throw new Error('Schedule creation failed')
      }
      return schedule
    },

    update: async (
      id: string,
      payload: UpdateScheduleRequestDto,
    ): Promise<WorkflowSchedule> => {
      const response = await apiClient.updateSchedule(id, payload)
      if (response.error) throw new Error('Failed to update schedule')
      const schedule = (response.data ?? null) as WorkflowSchedule | null
      if (!schedule) {
        throw new Error('Schedule update failed')
      }
      return schedule
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteSchedule(id)
      if (response.error) throw new Error('Failed to delete schedule')
    },

    pause: async (id: string): Promise<WorkflowSchedule> => {
      const response = await apiClient.pauseSchedule(id)
      if (response.error) throw new Error('Failed to pause schedule')
      return fetchScheduleById(id)
    },

    resume: async (id: string): Promise<WorkflowSchedule> => {
      const response = await apiClient.resumeSchedule(id)
      if (response.error) throw new Error('Failed to resume schedule')
      return fetchScheduleById(id)
    },

    runNow: async (id: string): Promise<void> => {
      const response = await apiClient.triggerSchedule(id)
      if (response.error) throw new Error('Failed to trigger schedule')
    },
  },

  apiKeys: {
    list: async (): Promise<ApiKeyResponseDto[]> => {
      const response = await apiClient.listApiKeys()
      if (response.error) throw new Error('Failed to fetch API keys')
      return response.data || []
    },

    get: async (id: string): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.getApiKey(id)
      if (response.error) throw new Error('Failed to fetch API key')
      if (!response.data) throw new Error('API key not found')
      return response.data
    },

    create: async (input: CreateApiKeyDto): Promise<CreateApiKeyResponseDto> => {
      const response = await apiClient.createApiKey(input)
      if (response.error) throw new Error('Failed to create API key')
      if (!response.data) throw new Error('API key creation failed')
      return response.data
    },

    update: async (id: string, input: UpdateApiKeyDto): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.updateApiKey(id, input)
      if (response.error) throw new Error('Failed to update API key')
      if (!response.data) throw new Error('API key update failed')
      return response.data
    },

    revoke: async (id: string): Promise<ApiKeyResponseDto> => {
      const response = await apiClient.revokeApiKey(id)
      if (response.error) throw new Error('Failed to revoke API key')
      if (!response.data) throw new Error('API key revocation failed')
      return response.data
    },

    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteApiKey(id)
      if (response.error) throw new Error('Failed to delete API key')
    },
  },

  executions: {
    start: async (
      workflowId: string,
      options?: {
        inputs?: Record<string, unknown>
        versionId?: string
        version?: number
      }
    ): Promise<{ executionId: string }> => {
      const payload = options
        ? {
            inputs: options.inputs,
            versionId: options.versionId,
            version: options.version,
          }
        : undefined
      const response = await apiClient.runWorkflow(workflowId, payload)
      if ((response as any).error) {
        const error = (response as any).error
        const errorMessage =
          error?.message ||
          (typeof error === 'string' ? error : 'Failed to start execution')
        throw new Error(errorMessage)
      }
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

    getConfig: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunConfig(executionId)
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run configuration')
      }
      return response.data
    },

    getResult: async (executionId: string) => {
      const response = await apiClient.getWorkflowRunResult(executionId)
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run result')
      }
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

    getTerminalChunks: async (executionId: string, params?: { nodeRef?: string; stream?: string; cursor?: string; startTime?: Date; endTime?: Date }): Promise<TerminalChunkResponse> => {
      const headers = await getAuthHeaders()
      const url = new URL(`${API_BASE_URL}/api/v1/workflows/runs/${executionId}/terminal`)
      if (params?.nodeRef) url.searchParams.set('nodeRef', params.nodeRef)
      if (params?.stream) url.searchParams.set('stream', params.stream)
      if (params?.cursor) url.searchParams.set('cursor', params.cursor)
      if (params?.startTime) url.searchParams.set('startTime', params.startTime.toISOString())
      if (params?.endTime) url.searchParams.set('endTime', params.endTime.toISOString())
      const response = await fetch(url.toString(), { headers })
      if (!response.ok) {
        throw new Error('Failed to fetch terminal chunks')
      }
      return (await response.json()) as TerminalChunkResponse
    },

    getArtifacts: async (executionId: string): Promise<RunArtifactsResponse> => {
      const response = await apiClient.getWorkflowRunArtifacts(executionId) as any
      if (response.error || !response.data) {
        throw new Error('Failed to fetch run artifacts')
      }
      return response.data
    },

    downloadArtifact: async (executionId: string, artifactId: string): Promise<Blob> => {
      try {
        return await apiClient.downloadWorkflowRunArtifact(executionId, artifactId)
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to download artifact')
      }
    },

        stream: async (executionId: string, options?: { cursor?: string; temporalRunId?: string; terminalCursor?: string; logCursor?: string }): Promise<EventSource> => {
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
              // Ignore token fetch errors for SSE, will fallback to existing
            }
          }

          // Build URL with query params
          const params = new URLSearchParams()
          if (options?.cursor) params.set('cursor', options.cursor)
          if (options?.temporalRunId) params.set('temporalRunId', options.temporalRunId)
          if (options?.terminalCursor) params.set('terminalCursor', options.terminalCursor)
          if (options?.logCursor) params.set('logCursor', options.logCursor)
          const query = params.toString()
          const url = `${API_BASE_URL}/api/v1/workflows/runs/${executionId}/stream${query ? `?${query}` : ''}`

          // Build auth headers
          const headers: Record<string, string> = {}
          // For local auth with admin credentials, use Basic Auth
          if (storeState.provider === 'local' && storeState.adminUsername && storeState.adminPassword) {
            const credentials = btoa(`${storeState.adminUsername}:${storeState.adminPassword}`)
            headers['Authorization'] = `Basic ${credentials}`
          } else if (token && token.trim().length > 0) {
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

    getRun: async (runId: string) => {
      const response = await apiClient.getWorkflowRun(runId)
      if (response.error) throw new Error('Failed to fetch run')
      if (!response.data) throw new Error('Run not found')
      return response.data
    },

    getLogs: async (runId: string, options?: { nodeRef?: string; stream?: 'stdout' | 'stderr' | 'console'; level?: 'debug' | 'info' | 'warn' | 'error'; limit?: number; cursor?: string; startTime?: string; endTime?: string }) => {
      const client = createShipSecClient({
        baseUrl: API_BASE_URL,
        middleware: {
          async onRequest({ request }) {
            const headers = await getAuthHeaders()
            if (headers['Authorization']) {
              request.headers.set('Authorization', headers['Authorization'])
            }
            if (headers['X-Organization-Id']) {
              request.headers.set('X-Organization-Id', headers['X-Organization-Id'])
            }
            return request
          },
        },
      })

      const response = await client.getWorkflowRunLogs(runId, options)
      if (response.error) {
        throw new Error('Failed to fetch logs')
      }
      return response.data as {
        runId: string
        logs: Array<{
          id: string
          runId: string
          nodeId: string
          level: 'debug' | 'info' | 'warn' | 'error'
          message: string
          timestamp: string
        }>
        totalCount: number
        hasMore: boolean
        nextCursor?: string
      }
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

  artifacts: {
    list: async (filters?: ArtifactListFilters) => {
      const response = await apiClient.listArtifacts(filters) as any
      if (response.error) {
        throw new Error('Failed to fetch artifacts')
      }
      return response.data || { artifacts: [] }
    },

    download: async (id: string): Promise<Blob> => {
      const headers = await getAuthHeaders()
      const response = await fetch(`${API_BASE_URL}/api/v1/artifacts/${id}/download`, {
        headers,
      })
      if (!response.ok) {
        throw new Error('Failed to download artifact')
      }
      return await response.blob()
    },
  },

    humanInputs: {
    list: async (filters: { status?: 'pending' | 'resolved' | 'expired' | 'cancelled'; type?: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge' }) => {
      const response = await apiClient.listHumanInputs({
        status: filters.status,
        inputType: filters.type,
      })
      if (response.error) throw new Error('Failed to fetch human inputs')
      return response.data || []
    },

    get: async (id: string) => {
      const response = await apiClient.getHumanInput(id)
      if (response.error) throw new Error('Failed to fetch human input')
      if (!response.data) throw new Error('Human input not found')
      return response.data
    },

    resolve: async (id: string, payload: { status: 'resolved' | 'rejected'; responseData?: any; comment?: string }) => {
      const response = await apiClient.resolveHumanInput(id, {
        responseData: {
          ...payload.responseData,
          resolution: payload.status, // Add explicit resolution field
          comment: payload.comment,
        },
      })
      if (response.error) throw new Error('Failed to resolve human input')
      return response.data
    },
  },

}

export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  return getAuthHeaders()
}

export function buildApiUrl(path: string): string {
  return apiClient.buildUrl(path)
}

export default api
