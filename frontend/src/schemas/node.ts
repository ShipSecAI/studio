import { z } from 'zod'
import type { InputPort } from './component'

// ... existing code ...

export interface FrontendNodeData extends NodeData {
  componentId?: string
  componentSlug?: string
  componentVersion?: string
  parameters?: Record<string, any>
  inputs?: Record<string, InputMapping>
  dynamicInputs?: InputPort[]
  dynamicOutputs?: InputPort[]
  status?: NodeStatus
  executionTime?: number
  error?: string
}

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
  'waiting',
  'awaiting_input',
  'skipped'
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
 * Node config with separated params and inputOverrides
 * Backend structure: { params, inputOverrides, joinStrategy?, streamId?, groupId?, maxConcurrency? }
 */
export const NodeConfigSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  inputOverrides: z.record(z.string(), z.unknown()).default({}),
  joinStrategy: z.enum(['all', 'any', 'first']).optional(),
  streamId: z.string().optional(),
  groupId: z.string().optional(),
  maxConcurrency: z.number().int().positive().optional(),
}).passthrough() // Allow additional fields like dynamic ports

export type NodeConfig = z.infer<typeof NodeConfigSchema>

/**
 * Node data contains component configuration and state
 * Backend structure: { label: string, config: { params, inputOverrides, ... } }
 * Frontend extends with: { componentSlug, componentVersion, status, etc. }
 */
export const NodeDataSchema = z.object({
  // Backend fields (required from backend)
  label: z.string(),
  config: NodeConfigSchema.default({ params: {}, inputOverrides: {} }),
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
  inputs?: Record<string, InputMapping>
  dynamicInputs?: InputPort[]
  dynamicOutputs?: InputPort[]
  status?: NodeStatus
  executionTime?: number
  error?: string
}
