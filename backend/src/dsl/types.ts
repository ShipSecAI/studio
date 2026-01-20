import { z } from 'zod';

export const WorkflowActionSchema = z.object({
  ref: z.string(),
  componentId: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  inputOverrides: z.record(z.string(), z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  inputMappings: z
    .record(
      z.string(),
      z.object({
        sourceRef: z.string(),
        sourceHandle: z.string(),
      }),
    )
    .default({}),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().optional(),
      initialIntervalSeconds: z.number().optional(),
      maximumIntervalSeconds: z.number().optional(),
      backoffCoefficient: z.number().optional(),
      nonRetryableErrorTypes: z.array(z.string()).optional(),
      errorTypePolicies: z
        .record(
          z.string(),
          z.object({
            retryable: z.boolean().optional(),
            retryDelayMs: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  sourceRef: z.string(),
  targetRef: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  kind: z.enum(['success', 'error']).default('success'),
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowNodeMetadataSchema = z.object({
  ref: z.string(),
  label: z.string().optional(),
  joinStrategy: z.enum(['all', 'any', 'first']).optional(),
  maxConcurrency: z.number().int().positive().optional(),
  groupId: z.string().optional(),
  streamId: z.string().optional(),
  mode: z.enum(['normal', 'tool']).default('normal'),
  toolConfig: z
    .object({
      boundInputIds: z.array(z.string()).default([]),
      exposedInputIds: z.array(z.string()).default([]),
    })
    .optional(),
});

export type WorkflowNodeMetadata = z.infer<typeof WorkflowNodeMetadataSchema>;

export const WorkflowDefinitionSchema = z.object({
  version: z.number().int().positive().default(2),
  title: z.string(),
  description: z.string().optional(),
  entrypoint: z.object({ ref: z.string() }),
  nodes: z.record(z.string(), WorkflowNodeMetadataSchema).default({}),
  edges: z.array(WorkflowEdgeSchema).default([]),
  dependencyCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  actions: z.array(WorkflowActionSchema),
  config: z.object({
    environment: z.string().default('default'),
    timeoutSeconds: z.number().default(0),
  }),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
