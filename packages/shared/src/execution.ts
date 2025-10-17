import { z } from 'zod';

export const EXECUTION_STATUS = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT'
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];

export const ExecutionStatusSchema = z.enum(EXECUTION_STATUS);

export const FailureSummarySchema = z.object({
  reason: z.string(),
  temporalCode: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type FailureSummary = z.infer<typeof FailureSummarySchema>;

export const ProgressSummarySchema = z.object({
  completedActions: z.number().int().nonnegative(),
  totalActions: z.number().int().positive(),
});

export type ProgressSummary = z.infer<typeof ProgressSummarySchema>;

export const WorkflowRunStatusSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  status: ExecutionStatusSchema,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  taskQueue: z.string(),
  historyLength: z.number().int().nonnegative(),
  progress: ProgressSummarySchema.optional(),
  failure: FailureSummarySchema.optional(),
});

export type WorkflowRunStatusPayload = z.infer<typeof WorkflowRunStatusSchema>;

export const TRACE_EVENT_TYPES = ['STARTED', 'PROGRESS', 'COMPLETED', 'FAILED'] as const;
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];
export const TraceEventTypeSchema = z.enum(TRACE_EVENT_TYPES);

export const TRACE_EVENT_LEVELS = ['info', 'warn', 'error', 'debug'] as const;
export type TraceEventLevel = (typeof TRACE_EVENT_LEVELS)[number];
export const TraceEventLevelSchema = z.enum(TRACE_EVENT_LEVELS);

export const TraceErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  code: z.string().optional(),
});

export type TraceError = z.infer<typeof TraceErrorSchema>;

export const TraceEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  type: TraceEventTypeSchema,
  level: TraceEventLevelSchema,
  timestamp: z.string().datetime(),
  message: z.string().optional(),
  error: TraceErrorSchema.optional(),
  outputSummary: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type TraceEventPayload = z.infer<typeof TraceEventSchema>;

export const TraceStreamEnvelopeSchema = z.object({
  runId: z.string(),
  events: z.array(TraceEventSchema),
  cursor: z.string().optional(),
});

export type TraceStreamEnvelope = z.infer<typeof TraceStreamEnvelopeSchema>;

export const ExecutionContractSchema = z.object({
  workflowRunStatus: WorkflowRunStatusSchema.describe('Primary status payload returned by GET /workflows/runs/:id/status'),
  traceEvent: TraceEventSchema.describe('Individual trace event emitted by worker/trace adapter'),
});

export type ExecutionContract = z.infer<typeof ExecutionContractSchema>;
