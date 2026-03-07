import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSecretSchema = z.object({
  name: z.string().min(1).describe('Human-readable unique secret name'),
  value: z.string().min(1).describe('Secret plaintext value'),
  description: z.string().describe('Optional description for operators').optional(),
  tags: z.array(z.string()).describe('Optional tags to help organize secrets').optional(),
});
export class CreateSecretDto extends createZodDto(CreateSecretSchema) {}

export const RotateSecretSchema = z.object({
  value: z.string().min(1).describe('New plaintext secret value'),
});
export class RotateSecretDto extends createZodDto(RotateSecretSchema) {}

export const UpdateSecretSchema = z.object({
  name: z.string().min(1).describe('Updated secret name (must remain unique)').optional(),
  description: z.string().nullable().describe('Updated description for the secret').optional(),
  tags: z.array(z.string()).nullable().describe('Updated tags for the secret').optional(),
});
export class UpdateSecretDto extends createZodDto(UpdateSecretSchema) {}

export const SecretVersionResponseSchema = z.object({
  id: z.string(),
  version: z.number(),
  createdAt: z.string().datetime(),
  createdBy: z.string().nullable().optional(),
});
export class SecretVersionResponse extends createZodDto(SecretVersionResponseSchema) {}

export const SecretSummaryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activeVersion: SecretVersionResponseSchema.nullable()
    .describe('Metadata about the active version (value is never returned)')
    .optional(),
});
export class SecretSummaryResponse extends createZodDto(SecretSummaryResponseSchema) {
  static fromEntity(e: {
    id: string;
    name: string;
    description?: string | null;
    tags?: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    activeVersion?: {
      id: string;
      version: number;
      createdAt: Date;
      createdBy?: string | null;
    } | null;
  }): SecretSummaryResponse {
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      tags: e.tags,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      activeVersion: e.activeVersion
        ? {
            id: e.activeVersion.id,
            version: e.activeVersion.version,
            createdAt: e.activeVersion.createdAt.toISOString(),
            createdBy: e.activeVersion.createdBy,
          }
        : e.activeVersion,
    };
  }
}

export const SecretValueResponseSchema = z.object({
  secretId: z.string(),
  version: z.number(),
  value: z.string().describe('Decrypted secret value'),
});
export class SecretValueResponse extends createZodDto(SecretValueResponseSchema) {}
