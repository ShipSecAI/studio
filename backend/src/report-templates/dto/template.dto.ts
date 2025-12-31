import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateReportTemplateSchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().optional(),
  content: z.record(z.unknown()),
  inputSchema: z.record(z.unknown()),
  sampleData: z.record(z.unknown()).optional(),
  isSystem: z.boolean().optional(),
});

export class CreateReportTemplateDto extends createZodDto(CreateReportTemplateSchema) {}

export const UpdateReportTemplateSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  sampleData: z.record(z.unknown()).optional(),
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
  content: z.record(z.unknown()),
  inputSchema: z.record(z.unknown()),
  sampleData: z.record(z.unknown()).nullable(),
  version: z.number(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class TemplateResponseDto extends createZodDto(TemplateResponseSchema) {
  static create(template: {
    id: string;
    name: string;
    description: string | null;
    content: Record<string, unknown>;
    inputSchema: Record<string, unknown>;
    sampleData: Record<string, unknown> | null;
    version: number;
    isSystem: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): TemplateResponseDto {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      content: template.content,
      inputSchema: template.inputSchema,
      sampleData: template.sampleData,
      version: template.version,
      isSystem: template.isSystem,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}

export const GenerateReportSchema = z.object({
  templateId: z.string().uuid(),
  data: z.record(z.unknown()),
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

export const GenerateTemplateSchema = z.object({
  prompt: z.string().min(10).describe('Description of the template to generate'),
  systemPrompt: z.string().optional().describe('Custom system prompt for the AI'),
  model: z.string().optional().describe('Model to use for generation'),
});

export class GenerateTemplateDto extends createZodDto(GenerateTemplateSchema) {}
