import { z } from 'zod'

export const NodeTypeEnum = z.enum([
  'input',
  'scan',
  'process',
  'output'
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
 */
export const NodeDataSchema = z.object({
  // Component identification
  componentSlug: z.string(),
  componentVersion: z.string(),
  label: z.string().optional(), // Display label (defaults to component name)

  // User-configured parameters
  parameters: z.record(z.string(), z.any()).default({}),

  // Input mappings (which output connects to which input)
  inputs: z.record(z.string(), InputMappingSchema).optional(),

  // Execution state
  status: NodeStatusEnum.default('idle'),
  executionTime: z.number().optional(),
  error: z.string().optional(),

  // Legacy support
  config: z.record(z.string(), z.any()).optional(),
})

export type NodeData = z.infer<typeof NodeDataSchema>

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type NodePosition = z.infer<typeof NodePositionSchema>

export const NodeSchema = z.object({
  id: z.string(),
  type: NodeTypeEnum,
  position: NodePositionSchema,
  data: NodeDataSchema,
})

export type Node = z.infer<typeof NodeSchema>