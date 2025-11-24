import { ExecutionStatusSchema } from '@shipsec/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkflowViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const WorkflowNodeDataSchema = z.object({
  label: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  
  data: WorkflowNodeDataSchema,
});

export class WorkflowNodeDto extends createZodDto(WorkflowNodeSchema) {}

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const WorkflowGraphSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema),
  viewport: WorkflowViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
});

export class WorkflowGraphDto extends createZodDto(WorkflowGraphSchema) {}
export type WorkflowGraph = WorkflowGraphDto;
export class CreateWorkflowRequestDto extends WorkflowGraphDto {}
export class UpdateWorkflowRequestDto extends WorkflowGraphDto {}

export const RunWorkflowRequestSchema = z
  .object({
    inputs: z.record(z.string(), z.unknown()).optional(),
    versionId: z.string().uuid().optional(),
    version: z.coerce.number().int().min(1).optional(),
  })
  .refine(
    (value) => !(value.version && value.versionId),
    'Provide either version or versionId, not both',
  );

export class RunWorkflowRequestDto extends createZodDto(RunWorkflowRequestSchema) {}

export const ListRunsQuerySchema = z.object({
  workflowId: z
    .string()
    .trim()
    .min(1)
    .optional(),
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(ExecutionStatusSchema)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export class ListRunsQueryDto extends createZodDto(ListRunsQuerySchema) {}

export const TemporalRunQuerySchema = z.object({
  temporalRunId: z
    .string()
    .trim()
    .min(1)
    .optional(),
});

export class TemporalRunQueryDto extends createZodDto(TemporalRunQuerySchema) {}

export const StreamRunQuerySchema = TemporalRunQuerySchema.extend({
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional(),
  terminalCursor: z.string().trim().optional(),
});

export class StreamRunQueryDto extends createZodDto(StreamRunQuerySchema) {}

export const WorkflowLogsQuerySchema = z.object({
  nodeRef: z
    .string()
    .trim()
    .min(1)
    .optional(),
  stream: z
    .string()
    .trim()
    .min(1)
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export class WorkflowLogsQueryDto extends createZodDto(WorkflowLogsQuerySchema) {}

export const TerminalChunksQuerySchema = z.object({
  nodeRef: z.string().trim().min(1).optional(),
  stream: z.enum(['stdout', 'stderr', 'pty']).optional(),
  cursor: z.string().trim().optional(),
  startTime: z.string().datetime().optional(), // ISO 8601 datetime string
  endTime: z.string().datetime().optional(), // ISO 8601 datetime string
});

export class TerminalChunksQueryDto extends createZodDto(TerminalChunksQuerySchema) {}

// API Response DTOs for flattened workflow structures
// These represent the actual API response format after the service flattens the graph fields

// Type for service layer (with Date objects from DB)
export interface ServiceWorkflowResponse {
  id: string;
  name: string;
  description?: string | null;
  graph: z.infer<typeof WorkflowGraphSchema>;  // The original stored graph (contains nodes, edges, viewport)
  compiledDefinition: any | null;
  lastRun: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
  currentVersionId: string | null;
  currentVersion: number | null;
}

// Zod schema for API response validation (with string dates for JSON serialization)
export const WorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  graph: WorkflowGraphSchema,  // The original stored graph (contains nodes, edges, viewport)
  compiledDefinition: z.unknown().nullable(),
  lastRun: z.string().nullable(), // Date string from JSON serialization
  runCount: z.number().int().nonnegative(),
  createdAt: z.string(), // Date string from JSON serialization
  updatedAt: z.string(), // Date string from JSON serialization
  currentVersionId: z.string().uuid().nullable(),
  currentVersion: z.number().int().positive().nullable(),
});

export class WorkflowResponseDto extends createZodDto(WorkflowResponseSchema) {}

export const WorkflowVersionResponseSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  version: z.number().int().positive(),
  graph: WorkflowGraphSchema,
  createdAt: z.string(),
})

export class WorkflowVersionResponseDto extends createZodDto(WorkflowVersionResponseSchema) {}
