import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { WorkflowResponseSchema } from '../workflows/dto/workflow-graph.dto';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const RequiredSecretResponseSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
});

export const TemplateManifestResponseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requiredSecrets: z.array(RequiredSecretResponseSchema).optional(),
  entryPoint: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  documentation: z.string().optional(),
});

export const TemplateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  author: z.string().nullable().optional(),
  repository: z.string(),
  path: z.string(),
  branch: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  manifest: TemplateManifestResponseSchema,
  graph: JsonRecordSchema.nullable().optional(),
  requiredSecrets: z.array(RequiredSecretResponseSchema).nullable().optional(),
  popularity: z.number().int(),
  isOfficial: z.boolean(),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class TemplateResponseDto extends createZodDto(TemplateResponseSchema) {}

export const TemplateCategoryResponseSchema = z.object({
  category: z.string().nullable(),
  count: z.number(),
});

export class TemplateCategoryResponseDto extends createZodDto(TemplateCategoryResponseSchema) {}

export const TemplateSubmissionResponseSchema = z.object({
  id: z.string(),
  templateName: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  repository: z.string(),
  branch: z.string().nullable().optional(),
  path: z.string(),
  commitSha: z.string().nullable().optional(),
  pullRequestNumber: z.number().nullable().optional(),
  pullRequestUrl: z.string().nullable().optional(),
  status: z.string(),
  submittedBy: z.string(),
  organizationId: z.string().nullable().optional(),
  manifest: TemplateManifestResponseSchema.nullable().optional(),
  graph: JsonRecordSchema.nullable().optional(),
  feedback: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class TemplateSubmissionResponseDto extends createZodDto(TemplateSubmissionResponseSchema) {}

export const TemplateRepoInfoResponseSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  url: z.string(),
});

export class TemplateRepoInfoResponseDto extends createZodDto(TemplateRepoInfoResponseSchema) {}

export const PublishTemplateRequestSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  author: z.string(),
});

export class PublishTemplateRequestDto extends createZodDto(PublishTemplateRequestSchema) {}

export const UseTemplateRequestSchema = z.object({
  workflowName: z.string(),
  secretMappings: z.record(z.string(), z.string()).optional(),
});

export class UseTemplateRequestDto extends createZodDto(UseTemplateRequestSchema) {}

export const UseTemplateResponseSchema = z.object({
  workflow: WorkflowResponseSchema,
  templateId: z.string(),
  templateName: z.string(),
});

export class UseTemplateResponseDto extends createZodDto(UseTemplateResponseSchema) {}

export const TemplateLibrarySyncResponseSchema = z.object({
  synced: z.array(z.string()),
  failed: z.array(
    z.object({
      path: z.string(),
      error: z.string(),
    }),
  ),
  unchanged: z.array(z.string()),
  total: z.number().int().nonnegative(),
  directoryCacheHit: z.boolean(),
});

export class TemplateLibrarySyncResponseDto extends createZodDto(
  TemplateLibrarySyncResponseSchema,
) {}
