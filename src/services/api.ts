import axios, { type AxiosInstance } from 'axios'
import { WorkflowSchema, type Workflow } from '@/schemas/workflow'
import { type Node } from '@/schemas/node'
import { type Edge } from '@/schemas/edge'
import {
  ComponentMetadataSchema,
  type ComponentMetadata,
} from '@/schemas/component'
import {
  ExecutionStatusResponseSchema,
  ExecutionLogSchema,
  type ExecutionLog,
  type ExecutionStatusResponse,
} from '@/schemas/execution'

/**
 * API Client Configuration
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds
})

/**
 * API Service
 * Centralized API client for all backend communication
 *
 * All responses are validated with Zod schemas for type safety
 */
export const api = {
  /**
   * Workflow endpoints
   */
  workflows: {
    /**
     * Get all workflows
     */
    list: async (): Promise<Workflow[]> => {
      const response = await apiClient.get('/workflows')
      return response.data.map((w: unknown) => WorkflowSchema.parse(w))
    },

    /**
     * Get specific workflow
     */
    get: async (id: string): Promise<Workflow> => {
      const response = await apiClient.get(`/workflows/${id}`)
      return WorkflowSchema.parse(response.data)
    },

    /**
     * Create new workflow
     */
    create: async (workflow: {
      name: string
      description?: string
      nodes: Node[]
      edges: Edge[]
    }): Promise<Workflow> => {
      const response = await apiClient.post('/workflows', workflow)
      return WorkflowSchema.parse(response.data)
    },

    /**
     * Update workflow
     */
    update: async (id: string, workflow: Partial<Workflow>): Promise<Workflow> => {
      const response = await apiClient.put(`/workflows/${id}`, workflow)
      return WorkflowSchema.parse(response.data)
    },

    /**
     * Delete workflow
     */
    delete: async (id: string): Promise<void> => {
      await apiClient.delete(`/workflows/${id}`)
    },
  },

  /**
   * Component endpoints
   */
  components: {
    /**
     * Get all available components
     */
    list: async (): Promise<ComponentMetadata[]> => {
      const response = await apiClient.get('/components')
      return response.data.map((c: unknown) => ComponentMetadataSchema.parse(c))
    },

    /**
     * Get specific component metadata
     */
    get: async (slug: string): Promise<ComponentMetadata> => {
      const response = await apiClient.get(`/components/${slug}`)
      return ComponentMetadataSchema.parse(response.data)
    },
  },

  /**
   * Execution endpoints
   */
  executions: {
    /**
     * Start workflow execution
     */
    start: async (
      workflowId: string,
      parameters?: Record<string, any>
    ): Promise<{ executionId: string }> => {
      const response = await apiClient.post(`/workflows/${workflowId}/execute`, {
        parameters,
      })
      return response.data
    },

    /**
     * Get execution status (for polling)
     */
    getStatus: async (executionId: string): Promise<ExecutionStatusResponse> => {
      const response = await apiClient.get(`/executions/${executionId}`)
      return ExecutionStatusResponseSchema.parse(response.data)
    },

    /**
     * Get execution logs
     */
    getLogs: async (executionId: string): Promise<ExecutionLog[]> => {
      const response = await apiClient.get(`/executions/${executionId}/logs`)
      return response.data.map((log: unknown) => ExecutionLogSchema.parse(log))
    },

    /**
     * Cancel running execution
     */
    cancel: async (executionId: string): Promise<{ success: boolean }> => {
      const response = await apiClient.post(`/executions/${executionId}/cancel`)
      return response.data
    },
  },
}

/**
 * API Error Handler
 * Can be used to intercept and handle API errors globally
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Server responded with error status
      console.error('API Error:', error.response.status, error.response.data)
    } else if (error.request) {
      // Request made but no response received
      console.error('Network Error: No response from server')
    } else {
      // Error in request configuration
      console.error('Request Error:', error.message)
    }
    return Promise.reject(error)
  }
)

export default api
