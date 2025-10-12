import { createShipSecClient } from '@shipsec/backend-client'
import {
  WorkflowMetadataSchema,
  WorkflowSchema,
  type WorkflowMetadata,
  type Workflow
} from '@/schemas/workflow'
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
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Create type-safe API client
const apiClient = createShipSecClient({
  baseUrl: API_BASE_URL,
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
     * Get all workflows (metadata only)
     */
    list: async (): Promise<WorkflowMetadata[]> => {
      const response = await apiClient.listWorkflows()
      if (response.error) throw new Error('Failed to fetch workflows')
      const workflows = response.data as unknown as any[]
      if (!workflows || !Array.isArray(workflows)) return []
      return workflows.map((w: unknown) => WorkflowMetadataSchema.parse(w))
    },

    /**
     * Get specific workflow
     */
    get: async (id: string): Promise<Workflow> => {
      const response = await apiClient.getWorkflow(id)
      if (response.error) throw new Error('Failed to fetch workflow')
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
      viewport?: { x: number; y: number; zoom: number }
    }): Promise<Workflow> => {
      // Transform frontend Node format to backend API format
      const backendNodes = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.data.label || '',
        position: node.position,
        config: node.data.parameters,
      }))

      const response = await apiClient.createWorkflow({
        name: workflow.name,
        description: workflow.description,
        nodes: backendNodes,
        edges: workflow.edges,
        viewport: workflow.viewport || { x: 0, y: 0, zoom: 1 },
      })
      if (response.error) throw new Error('Failed to create workflow')
      return WorkflowSchema.parse(response.data)
    },

    /**
     * Update workflow
     */
    update: async (id: string, workflow: Partial<Workflow>): Promise<Workflow> => {
      // Transform frontend Node format to backend API format
      const backendNodes = (workflow.nodes || []).map((node) => ({
        id: node.id,
        type: node.type,
        label: node.data.label || '',
        position: node.position,
        config: node.data.parameters,
      }))

      const response = await apiClient.updateWorkflow(id, {
        name: workflow.name || '',
        description: workflow.description,
        nodes: backendNodes,
        edges: workflow.edges || [],
        viewport: { x: 0, y: 0, zoom: 1 },
      })
      if (response.error) throw new Error('Failed to update workflow')
      return WorkflowSchema.parse(response.data)
    },

    /**
     * Delete workflow
     */
    delete: async (id: string): Promise<void> => {
      const response = await apiClient.deleteWorkflow(id)
      if (response.error) throw new Error('Failed to delete workflow')
    },

    /**
     * Commit workflow (compile DSL)
     */
    commit: async (id: string) => {
      const response = await apiClient.commitWorkflow(id)
      if (response.error) throw new Error('Failed to commit workflow')
      return response.data
    },

    /**
     * Run workflow
     */
    run: async (id: string) => {
      const response = await apiClient.runWorkflow(id)
      if (response.error) throw new Error('Failed to run workflow')
      return response.data
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
      const response = await apiClient.listComponents()
      if (response.error) throw new Error('Failed to fetch components')
      return (response.data as any[]).map((c: unknown) => ComponentMetadataSchema.parse(c))
    },

    /**
     * Get specific component metadata
     */
    get: async (slug: string): Promise<ComponentMetadata> => {
      const response = await apiClient.getComponent(slug)
      if (response.error) throw new Error('Failed to fetch component')
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
      _parameters?: Record<string, any>
    ): Promise<{ executionId: string }> => {
      const response = await apiClient.runWorkflow(workflowId)
      if (response.error) throw new Error('Failed to start execution')
      return { executionId: (response.data as any).runId }
    },

    /**
     * Get execution status (for polling)
     */
    getStatus: async (executionId: string): Promise<ExecutionStatusResponse> => {
      const response = await apiClient.getWorkflowRunStatus(executionId)
      if (response.error) throw new Error('Failed to fetch execution status')
      return ExecutionStatusResponseSchema.parse(response.data)
    },

    /**
     * Get execution logs
     */
    getLogs: async (executionId: string): Promise<ExecutionLog[]> => {
      const response = await apiClient.getWorkflowRunTrace(executionId)
      if (response.error) throw new Error('Failed to fetch execution logs')
      return ((response.data as any).events || []).map((log: unknown) => ExecutionLogSchema.parse(log))
    },

    /**
     * Cancel running execution
     */
    cancel: async (executionId: string): Promise<{ success: boolean }> => {
      const response = await apiClient.cancelWorkflowRun(executionId)
      if (response.error) throw new Error('Failed to cancel execution')
      return { success: true }
    },
  },

  /**
   * File endpoints
   */
  files: {
    /**
     * List all files
     */
    list: async () => {
      const response = await apiClient.listFiles()
      if (response.error) throw new Error('Failed to fetch files')
      return response.data
    },

    /**
     * Upload file
     */
    upload: async (file: File) => {
      const response = await apiClient.uploadFile(file)
      if (response.error) throw new Error('Failed to upload file')
      return response.data
    },

    /**
     * Download file
     */
    download: async (id: string) => {
      return apiClient.downloadFile(id)
    },

    /**
     * Delete file
     */
    delete: async (id: string) => {
      const response = await apiClient.deleteFile(id)
      if (response.error) throw new Error('Failed to delete file')
    },
  },
}

export default api
