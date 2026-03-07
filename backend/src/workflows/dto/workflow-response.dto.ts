import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// --- Trace schemas ---

const TraceFailureSchema = z
  .object({
    at: z.string().datetime(),
    reason: z.object({
      message: z.string(),
      name: z.string(),
    }),
  })
  .nullable()
  .optional();

const TraceRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1),
    initialIntervalSeconds: z.number().min(0),
    maximumIntervalSeconds: z.number().min(0),
    backoffCoefficient: z.number().min(0),
    nonRetryableErrorTypes: z.array(z.string()),
  })
  .nullable()
  .optional();

const TraceMetadataSchema = z
  .object({
    activityId: z.string(),
    attempt: z.number().int().min(0),
    correlationId: z.string(),
    streamId: z.string(),
    joinStrategy: z.enum(['all', 'any', 'first']),
    triggeredBy: z.string(),
    failure: TraceFailureSchema,
    retryPolicy: TraceRetryPolicySchema,
  })
  .nullable()
  .optional();

const TraceErrorSchema = z
  .object({
    message: z.string(),
    stack: z.string(),
    code: z.string(),
    type: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .nullable()
  .optional();

const TraceEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  type: z.enum(['STARTED', 'PROGRESS', 'COMPLETED', 'FAILED']),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  timestamp: z.string().datetime(),
  message: z.string().nullable(),
  error: TraceErrorSchema,
  outputSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: TraceMetadataSchema,
});

export const TraceEnvelopeSchema = z.object({
  runId: z.string(),
  events: z.array(TraceEventSchema),
  cursor: z.string().nullable(),
});
export class TraceEnvelopeDto extends createZodDto(TraceEnvelopeSchema) {}

// --- Data flow schemas ---

const DataFlowPacketSchema = z.object({
  id: z.string(),
  runId: z.string(),
  sourceNode: z.string(),
  targetNode: z.string(),
  inputKey: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  timestamp: z.number().int(),
  visualTime: z.number(),
  size: z.number(),
  type: z.enum(['file', 'json', 'text', 'binary']),
});

export const DataFlowEnvelopeSchema = z.object({
  runId: z.string(),
  packets: z.array(DataFlowPacketSchema),
});
export class DataFlowEnvelopeDto extends createZodDto(DataFlowEnvelopeSchema) {}

// --- Run config schema ---

export const RunConfigSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string().nullable(),
  workflowVersion: z.number().int().nullable(),
  inputs: z.record(z.string(), z.unknown()),
});
export class RunConfigDto extends createZodDto(RunConfigSchema) {}

// --- Run status enum ---

const RunStatusEnum = z.enum([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
  'UNKNOWN',
]);

const TriggerTypeEnum = z.enum(['manual', 'schedule', 'api']);

// --- Run activity response ---

export const RunActivityResponseSchema = z.object({
  totalRuns: z.number(),
  activity: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
    }),
  ),
});
export class RunActivityResponseDto extends createZodDto(RunActivityResponseSchema) {}

// --- Run list item ---

const InputPreviewSchema = z.object({
  runtimeInputs: z.record(z.string(), z.unknown()).optional(),
  nodeOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

const RunListItemSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  organizationId: z.string(),
  status: RunStatusEnum,
  startTime: z.string().datetime(),
  endTime: z.string().datetime().nullable(),
  temporalRunId: z.string(),
  workflowVersionId: z.string().nullable(),
  workflowVersion: z.number().nullable(),
  workflowName: z.string(),
  eventCount: z.number(),
  nodeCount: z.number(),
  duration: z.number(),
  triggerType: TriggerTypeEnum,
  triggerSource: z.string().nullable(),
  triggerLabel: z.string().nullable(),
  inputPreview: InputPreviewSchema.optional(),
});

export const RunListResponseSchema = z.object({
  runs: z.array(RunListItemSchema),
});
export class RunListResponseDto extends createZodDto(RunListResponseSchema) {}

// --- Single run detail ---

export const RunDetailSchema = RunListItemSchema.extend({
  nodeCount: z.number(),
  duration: z.number(),
  temporalRunId: z.string().nullable(),
});
export class RunDetailDto extends createZodDto(RunDetailSchema) {}

// --- Child run ---

const ChildRunSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  parentNodeRef: z.string().nullable(),
  status: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const ChildRunListResponseSchema = z.object({
  runs: z.array(ChildRunSchema),
});
export class ChildRunListResponseDto extends createZodDto(ChildRunListResponseSchema) {}

// --- Commit response ---

const ActionSchema = z.object({
  ref: z.string(),
  componentId: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const CommitResponseSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  entrypoint: z.object({ ref: z.string() }),
  actions: z.array(ActionSchema),
});
export class CommitResponseDto extends createZodDto(CommitResponseSchema) {}

// --- Run execution response ---

export const RunExecutionResponseSchema = z.object({
  runId: z.string().describe('Temporal workflow identifier'),
  workflowId: z.string().describe('Workflow record id'),
  temporalRunId: z.string().describe('Temporal first execution run id'),
  taskQueue: z.string().describe('Temporal task queue used for execution'),
  workflowVersionId: z.string().describe('Workflow version identifier used for execution'),
  workflowVersion: z.number().int().describe('Workflow version number used for execution'),
  status: RunStatusEnum,
});
export class RunExecutionResponseDto extends createZodDto(RunExecutionResponseSchema) {}

// --- Node IO ---

const NodeStatusEnum = z.enum(['running', 'completed', 'failed', 'skipped']);

const NodeIOItemSchema = z.object({
  nodeRef: z.string(),
  componentId: z.string(),
  status: NodeStatusEnum,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  durationMs: z.number().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  inputsSize: z.number(),
  outputsSize: z.number(),
  inputsSpilled: z.boolean(),
  outputsSpilled: z.boolean(),
  errorMessage: z.string().nullable(),
});

export const NodeIOListResponseSchema = z.object({
  runId: z.string(),
  nodes: z.array(NodeIOItemSchema),
});
export class NodeIOListResponseDto extends createZodDto(NodeIOListResponseSchema) {}

export const NodeIODetailSchema = NodeIOItemSchema.extend({
  inputsTruncated: z.boolean(),
  outputsTruncated: z.boolean(),
});
export class NodeIODetailDto extends createZodDto(NodeIODetailSchema) {}

// --- Logs ---

const LogEntrySchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  timestamp: z.string().datetime(),
});

export const LogsResponseSchema = z.object({
  runId: z.string(),
  logs: z.array(LogEntrySchema),
  totalCount: z.number(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export class LogsResponseDto extends createZodDto(LogsResponseSchema) {}
