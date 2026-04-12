import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReportTemplateStatusSchema = z.enum(['draft', 'published', 'archived']);
export const ReportTemplateScopeSchema = z.enum(['builtin', 'organization']);
export const ReportTemplateVisibilitySchema = z.enum(['chat_only', 'library']);
export const ReportTemplateVersionKindSchema = z.enum(['draft', 'published']);

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const ReportTemplateVersionResponseSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  kind: ReportTemplateVersionKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  htmlTemplate: z.string(),
  css: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  sampleData: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export class ReportTemplateVersionResponseDto extends createZodDto(
  ReportTemplateVersionResponseSchema,
) {}

export const ReportTemplateResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: ReportTemplateStatusSchema,
  scope: ReportTemplateScopeSchema,
  visibility: ReportTemplateVisibilitySchema,
  createdBy: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  publishedVersionId: z.string().uuid().nullable(),
  draftVersionId: z.string().uuid().nullable(),
  draftSessionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedVersion: ReportTemplateVersionResponseSchema.nullable().optional(),
  draftVersion: ReportTemplateVersionResponseSchema.nullable().optional(),
});

export class ReportTemplateResponseDto extends createZodDto(ReportTemplateResponseSchema) {}

export const CreateReportTemplateDraftRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  category: z.string().trim().min(1),
  htmlTemplate: z.string().trim().min(1),
  css: z.string().default(''),
  inputSchema: JsonRecordSchema.default({}),
  sampleData: JsonRecordSchema.default({}),
  chatSessionId: z.string().uuid().optional(),
});

export class CreateReportTemplateDraftRequestDto extends createZodDto(
  CreateReportTemplateDraftRequestSchema,
) {}

export const UpdateReportTemplateDraftRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  category: z.string().trim().min(1).optional(),
  htmlTemplate: z.string().trim().min(1).optional(),
  css: z.string().optional(),
  inputSchema: JsonRecordSchema.optional(),
  sampleData: JsonRecordSchema.optional(),
  chatSessionId: z.string().uuid().nullable().optional(),
});

export class UpdateReportTemplateDraftRequestDto extends createZodDto(
  UpdateReportTemplateDraftRequestSchema,
) {}

export const PublishReportTemplateRequestSchema = z.object({
  chatSessionId: z.string().uuid().optional(),
});

export class PublishReportTemplateRequestDto extends createZodDto(
  PublishReportTemplateRequestSchema,
) {}

export const RenderReportTemplatePreviewRequestSchema = z.object({
  data: JsonRecordSchema.default({}),
});

export class RenderReportTemplatePreviewRequestDto extends createZodDto(
  RenderReportTemplatePreviewRequestSchema,
) {}

export const RenderPublishedReportTemplateRequestSchema = z.object({
  versionId: z.string().uuid().nullable().optional(),
  data: JsonRecordSchema.default({}),
});

export class RenderPublishedReportTemplateRequestDto extends createZodDto(
  RenderPublishedReportTemplateRequestSchema,
) {}

export const RenderReportTemplateResponseSchema = z.object({
  templateId: z.string().uuid(),
  versionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  kind: ReportTemplateVersionKindSchema,
  html: z.string(),
  css: z.string(),
  data: JsonRecordSchema,
});

export class RenderReportTemplateResponseDto extends createZodDto(
  RenderReportTemplateResponseSchema,
) {}
