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
  metadata: z.record(z.any()).optional(),
})

export type ExecutionLog = z.infer<typeof ExecutionLogSchema>

export const ExecutionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: ExecutionStatusEnum,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  logs: z.array(ExecutionLogSchema).optional(),
  result: z.record(z.any()).optional(),
  error: z.string().optional(),
})

export type Execution = z.infer<typeof ExecutionSchema>