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
  viewport: WorkflowViewportSchema,
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export class WorkflowGraphDto extends createZodDto(WorkflowGraphSchema) {}
export class CreateWorkflowRequestDto extends WorkflowGraphDto {}
export class UpdateWorkflowRequestDto extends WorkflowGraphDto {}

export const RunWorkflowRequestSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
});

export class RunWorkflowRequestDto extends createZodDto(RunWorkflowRequestSchema) {}
export type RunWorkflowRequest = z.infer<typeof RunWorkflowRequestSchema>;

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
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

export const TemporalRunQuerySchema = z.object({
  temporalRunId: z
    .string()
    .trim()
    .min(1)
    .optional(),
});

export class TemporalRunQueryDto extends createZodDto(TemporalRunQuerySchema) {}
export type TemporalRunQuery = z.infer<typeof TemporalRunQuerySchema>;

export const StreamRunQuerySchema = TemporalRunQuerySchema.extend({
  cursor: z
    .string()
    .trim()
    .min(1)
    .optional(),
});

export class StreamRunQueryDto extends createZodDto(StreamRunQuerySchema) {}
export type StreamRunQuery = z.infer<typeof StreamRunQuerySchema>;

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
export type WorkflowLogsQuery = z.infer<typeof WorkflowLogsQuerySchema>;

// API Response DTOs for flattened workflow structures
// These represent the actual API response format after the service flattens the graph fields

// Type for service layer (with Date objects from DB)
export interface ServiceWorkflowResponse {
  id: string;
  name: string;
  description?: string | null;
  graph: z.infer<typeof WorkflowGraphSchema>;  // The original stored graph
  nodes: z.infer<typeof WorkflowGraphSchema>['nodes'];  // Flattened from graph.nodes
  edges: z.infer<typeof WorkflowGraphSchema>['edges'];  // Flattened from graph.edges
  viewport: z.infer<typeof WorkflowGraphSchema>['viewport'];  // Flattened from graph.viewport
  compiledDefinition: any | null;
  lastRun: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Zod schema for API response validation (with string dates for JSON serialization)
export const WorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  graph: WorkflowGraphSchema,  // The original stored graph
  nodes: z.array(WorkflowNodeSchema).min(1),  // Flattened from graph.nodes
  edges: z.array(WorkflowEdgeSchema),  // Flattened from graph.edges
  viewport: WorkflowViewportSchema,  // Flattened from graph.viewport
  compiledDefinition: z.unknown().nullable(),
  lastRun: z.string().nullable(), // Date string from JSON serialization
  runCount: z.number().int().nonnegative(),
  createdAt: z.string(), // Date string from JSON serialization
  updatedAt: z.string(), // Date string from JSON serialization
});

export type WorkflowResponse = z.infer<typeof WorkflowResponseSchema>;
export class WorkflowResponseDto extends createZodDto(WorkflowResponseSchema) {}
