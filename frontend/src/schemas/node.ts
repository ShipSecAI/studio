import { z } from 'zod'

export const NodeTypeEnum = z.enum([
  'trigger',
  'input',
  'scan',
  'process',
  'output',
])

export type NodeType = z.infer<typeof NodeTypeEnum>

export const NodeStatusEnum = z.enum([
  'idle',
  'running',
  'success',
  'error',
  'waiting'
])

export type NodeStatus = z.infer<typeof NodeStatusEnum>

/**
 * Input mapping defines how node inputs are connected
 */
export const InputMappingSchema = z.object({
  source: z.string(),  // Source node ID
  output: z.string(),  // Output port ID from source node
})

export type InputMapping = z.infer<typeof InputMappingSchema>

/**
 * Node data contains component configuration and state
 * Backend structure: { label: string, config: Record<string, any> }
 * Frontend extends with: { componentSlug, componentVersion, parameters, status, etc. }
 */
export const NodeDataSchema = z.object({
  // Backend fields (required from backend)
  label: z.string(),
  config: z.record(z.string(), z.any()).default({}),
}).passthrough() // Allow additional frontend fields like componentSlug, status, etc.

export type NodeData = z.infer<typeof NodeDataSchema>

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type NodePosition = z.infer<typeof NodePositionSchema>

/**
 * Node schema matching backend structure exactly
 * Backend: { id, type, position, data: { label, config } }
 */
export const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: NodePositionSchema,
  data: NodeDataSchema,
})

export type Node = z.infer<typeof NodeSchema>

/**
 * Extended frontend node data type for React Flow
 * Includes additional frontend-specific fields
 */
export interface FrontendNodeData extends NodeData {
  componentId?: string
  componentSlug?: string
  componentVersion?: string
  parameters?: Record<string, any>
  inputs?: Record<string, InputMapping>
  status?: NodeStatus
  executionTime?: number
  error?: string
}
