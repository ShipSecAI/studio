import { z } from 'zod'

export const ExecutionStatusEnum = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
])

export type ExecutionStatus = z.infer<typeof ExecutionStatusEnum>

export const ExecutionLogLevelEnum = z.enum([
  'info',
  'warn',
  'error',
  'debug'
])

export type ExecutionLogLevel = z.infer<typeof ExecutionLogLevelEnum>

export const ExecutionLogSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
  nodeId: z.string().optional(),
  level: ExecutionLogLevelEnum,
  message: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type ExecutionLog = z.infer<typeof ExecutionLogSchema>

/**
 * Node execution result
 */
export const NodeResultSchema = z.object({
  nodeId: z.string(),
  status: z.enum(['pending', 'running', 'success', 'error']),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  outputs: z.record(z.string(), z.any()).optional(), // Output port values
  error: z.string().optional(),
})

export type NodeResult = z.infer<typeof NodeResultSchema>

/**
 * Execution status response (used for polling)
 */
export const ExecutionStatusResponseSchema = z.object({
  executionId: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: ExecutionStatusEnum,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),

  // Node-level results
  nodeResults: z.record(z.string(), NodeResultSchema),

  // Logs
  logs: z.array(ExecutionLogSchema).default([]),
})

export type ExecutionStatusResponse = z.infer<typeof ExecutionStatusResponseSchema>

/**
 * Full execution record
 */
export const ExecutionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: ExecutionStatusEnum,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  logs: z.array(ExecutionLogSchema).default([]),
  result: z.record(z.string(), z.any()).optional(),
  error: z.string().optional(),
})

export type Execution = z.infer<typeof ExecutionSchema>