import { z } from 'zod';

export const WorkflowActionSchema = z.object({
  ref: z.string(),
  componentId: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
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
});

export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const WorkflowDefinitionSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  entrypoint: z.object({ ref: z.string() }),
  actions: z.array(WorkflowActionSchema),
  config: z.object({
    environment: z.string().default('default'),
    timeoutSeconds: z.number().default(0),
  }),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
