import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';

export const WorkflowTemplateCategorySchema = z.enum([
  'code-security',
  'cloud-security',
  'attack-surface',
  'notification',
]);

export const WorkflowTemplateResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable(),
  category: WorkflowTemplateCategorySchema,
  graph: WorkflowGraphSchema,
  icon: z.string().nullable(),
  screenshotUrl: z.string().nullable().optional(),
  isFeatured: z.boolean().optional(),
  runCount: z.number().int().nonnegative().optional(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class WorkflowTemplateResponseDto extends createZodDto(WorkflowTemplateResponseSchema) {}

export const CreateWorkflowTemplateRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  category: WorkflowTemplateCategorySchema,
  graph: WorkflowGraphSchema,
  icon: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export class CreateWorkflowTemplateRequestDto extends createZodDto(
  CreateWorkflowTemplateRequestSchema,
) {}

export const InstantiateWorkflowTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
});

export class InstantiateWorkflowTemplateRequestDto extends createZodDto(
  InstantiateWorkflowTemplateRequestSchema,
) {}

export const DeleteWorkflowTemplateResponseSchema = z.object({
  success: z.literal(true),
});

export class DeleteWorkflowTemplateResponseDto extends createZodDto(
  DeleteWorkflowTemplateResponseSchema,
) {}
