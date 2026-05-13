import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AgentSkillFileSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string(),
  executable: z.boolean().optional(),
});

export const CreateAgentSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Name must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().min(1).max(1024),
  content: z.string().min(1),
  files: z.array(AgentSkillFileSchema).optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  allowedTools: z.string().optional(),
  isEnabled: z.boolean().optional(),
});

export class CreateAgentSkillDto extends createZodDto(CreateAgentSkillSchema) {}

export const UpdateAgentSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Name must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().min(1).max(1024).optional(),
  content: z.string().min(1).optional(),
  files: z.array(AgentSkillFileSchema).optional(),
  license: z.string().nullable().optional(),
  compatibility: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  allowedTools: z.string().nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export class UpdateAgentSkillDto extends createZodDto(UpdateAgentSkillSchema) {}

export const AgentSkillResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  files: z.array(AgentSkillFileSchema),
  license: z.string().nullable(),
  compatibility: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  allowedTools: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class AgentSkillResponseDto extends createZodDto(AgentSkillResponseSchema) {}

// Export classes with both names for backward compatibility (as values)
export const AgentSkillResponse = AgentSkillResponseDto;

// Type alias for use in type annotations
export type AgentSkillResponse = AgentSkillResponseDto;
