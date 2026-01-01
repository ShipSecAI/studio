import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RecordUnknownSchema = z.record(z.string(), z.any());

export const CreateReportTemplateSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().optional(),
  content: RecordUnknownSchema,
  inputSchema: RecordUnknownSchema,
  sampleData: RecordUnknownSchema.optional(),
  isSystem: z.boolean().optional(),
});

export class CreateReportTemplateDto extends createZodDto(CreateReportTemplateSchema) {}

export const UpdateReportTemplateSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().optional(),
  content: RecordUnknownSchema.optional(),
  inputSchema: RecordUnknownSchema.optional(),
  sampleData: RecordUnknownSchema.optional(),
});

export class UpdateReportTemplateDto extends createZodDto(UpdateReportTemplateSchema) {}

export const ListTemplatesQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('50').transform(Number),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  isSystem: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export class ListTemplatesQueryDto extends createZodDto(ListTemplatesQuerySchema) {}

export const TemplateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  content: RecordUnknownSchema,
  inputSchema: RecordUnknownSchema,
  sampleData: RecordUnknownSchema.nullable(),
  version: z.number(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class TemplateResponseDto extends createZodDto(TemplateResponseSchema) {}

export const PreviewTemplateSchema = z.object({
  data: RecordUnknownSchema.optional(),
});

export class PreviewTemplateDto extends createZodDto(PreviewTemplateSchema) {}

export const PreviewTemplateResponseSchema = z.object({
  templateId: z.string(),
  templateVersion: z.number(),
  sampleData: RecordUnknownSchema,
  renderedHtml: z.string(),
});

export class PreviewTemplateResponseDto extends createZodDto(PreviewTemplateResponseSchema) {}

export const GenerateReportSchema = z.object({
  templateId: z.string().uuid(),
  data: RecordUnknownSchema,
  format: z.enum(['pdf', 'html']).default('pdf'),
  fileName: z.string().optional(),
});

export class GenerateReportDto extends createZodDto(GenerateReportSchema) {}

export const GenerateReportResponseSchema = z.object({
  artifactId: z.string(),
  fileName: z.string(),
  format: z.enum(['pdf', 'html']),
  size: z.number(),
  templateId: z.string(),
  templateVersion: z.string(),
  generatedAt: z.string(),
});

export class GenerateReportResponseDto extends createZodDto(GenerateReportResponseSchema) {}
