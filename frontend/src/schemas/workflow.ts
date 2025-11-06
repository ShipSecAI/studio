import { z } from 'zod'
import type { components } from '@shipsec/backend-client'
import { NodeSchema } from './node'
import { EdgeSchema } from './edge'

/**
 * Workflow types from backend API client
 * These types are auto-generated from the OpenAPI specification
 */

// Extract workflow types from backend client
type WorkflowResponseDto = components['schemas']['WorkflowResponseDto']
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto']
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto']

/**
 * Workflow metadata (for list endpoint)
 * Uses WorkflowResponseDto from backend API
 */
export type WorkflowMetadata = WorkflowResponseDto

/**
 * Complete workflow (for detail endpoint)
 * Uses WorkflowResponseDto from backend API
 */
export type Workflow = WorkflowResponseDto

/**
 * Create workflow request
 * Uses CreateWorkflowRequestDto from backend API
 */
export type CreateWorkflow = CreateWorkflowRequestDto

/**
 * Update workflow request
 * Uses UpdateWorkflowRequestDto from backend API
 * Note: The backend type requires name, but we make it optional for partial updates
 */
export type UpdateWorkflow = UpdateWorkflowRequestDto

export const DEFAULT_WORKFLOW_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 1,
} as const

export const WorkflowViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
})

export type WorkflowViewport = z.infer<typeof WorkflowViewportSchema>

const normalizeViewport = (viewport?: WorkflowViewport | null): WorkflowViewport => ({
  x: viewport?.x ?? DEFAULT_WORKFLOW_VIEWPORT.x,
  y: viewport?.y ?? DEFAULT_WORKFLOW_VIEWPORT.y,
  zoom: viewport?.zoom ?? DEFAULT_WORKFLOW_VIEWPORT.zoom,
})

export const WorkflowGraphSchema = z.object({
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
  viewport: WorkflowViewportSchema.optional(),
})

type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

const BackendWorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().nullable().optional(),
  graph: WorkflowGraphSchema.optional(),
  // Legacy payload support (pre-graph nesting)
  nodes: z.array(NodeSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
  viewport: WorkflowViewportSchema.optional(),
  compiledDefinition: z.unknown().nullable().optional(),
  lastRun: z.string().datetime().nullable().optional(),
  runCount: z.number().int().min(0).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  currentVersionId: z.string().uuid().nullable().optional(),
  currentVersion: z.number().int().positive().nullable().optional(),
})

type BackendWorkflow = z.infer<typeof BackendWorkflowSchema>

const coerceGraph = (workflow: BackendWorkflow): WorkflowGraph => {
  const legacyNodes = workflow.nodes ?? []
  const legacyEdges = workflow.edges ?? []
  const source = workflow.graph ?? {
    nodes: legacyNodes,
    edges: legacyEdges,
    viewport: workflow.viewport,
  }

  return {
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    edges: Array.isArray(source.edges) ? source.edges : [],
    viewport: source.viewport,
  }
}

const normalizeWorkflow = (workflow: BackendWorkflow) => {
  const graph = coerceGraph(workflow)
  const viewport = normalizeViewport(graph.viewport ?? null)

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? null,
    nodes: graph.nodes,
    edges: graph.edges,
    viewport,
    graph: {
      ...graph,
      viewport,
    },
    compiledDefinition: workflow.compiledDefinition ?? null,
    lastRun: workflow.lastRun ?? null,
    runCount: workflow.runCount ?? 0,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    currentVersionId: workflow.currentVersionId ?? null,
    currentVersion: workflow.currentVersion ?? null,
  }
}

export type NormalizedWorkflow = ReturnType<typeof normalizeWorkflow>

export const WorkflowMetadataSchema = BackendWorkflowSchema.transform(normalizeWorkflow)
export type WorkflowMetadataNormalized = z.infer<typeof WorkflowMetadataSchema>

export const WorkflowSchema = BackendWorkflowSchema.transform(normalizeWorkflow)
export type WorkflowNormalized = z.infer<typeof WorkflowSchema>

export const WorkflowDraftSchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().nullable().optional(),
  nodes: z.array(NodeSchema).min(1, 'Workflow must include at least one node'),
  edges: z.array(EdgeSchema),
  viewport: WorkflowViewportSchema.optional(),
})

export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>

export const CreateWorkflowSchema = WorkflowDraftSchema
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>

export const UpdateWorkflowSchema = WorkflowDraftSchema.extend({
  id: z.string().uuid(),
})

export type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowSchema>

export const WorkflowImportSchema = z.union([
  z.object({
    name: z.string().min(1, 'Workflow name is required'),
    description: z.string().nullable().optional(),
    nodes: z.array(NodeSchema).min(1, 'Workflow must include at least one node'),
    edges: z.array(EdgeSchema),
    viewport: WorkflowViewportSchema.optional(),
  }),
  z.object({
    name: z.string().min(1, 'Workflow name is required'),
    description: z.string().nullable().optional(),
    graph: WorkflowGraphSchema,
  }),
])

export type WorkflowImport = z.infer<typeof WorkflowImportSchema>
