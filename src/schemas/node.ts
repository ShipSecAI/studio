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

export const NodeDataSchema = z.object({
  label: z.string(),
  config: z.record(z.any()).optional(),
  status: NodeStatusEnum.default('idle'),
  executionTime: z.number().optional(),
  error: z.string().optional(),
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