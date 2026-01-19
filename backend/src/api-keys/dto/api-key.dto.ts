import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { apiKeys } from '../../database/schema/api-keys';

export const ApiKeyPermissionsSchema = z.object({
  workflows: z.object({
    run: z.boolean(),
    list: z.boolean(),
    read: z.boolean(),
  }),
  runs: z.object({
    read: z.boolean(),
    cancel: z.boolean(),
  }),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(191),
  description: z.string().optional(),
  permissions: ApiKeyPermissionsSchema,
  expiresAt: z.string().datetime().optional(),
  rateLimit: z.number().int().positive().optional(),
  organizationId: z.string().optional(), // In case admin creates for another org in future
});

export class CreateApiKeyDto extends createZodDto(CreateApiKeySchema) {}

export const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().optional(),
  permissions: ApiKeyPermissionsSchema.optional(),
  isActive: z.boolean().optional(),
  rateLimit: z.number().int().positive().nullable().optional(),
});

export class UpdateApiKeyDto extends createZodDto(UpdateApiKeySchema) {}

export const ApiKeyResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  keyPrefix: z.string(),
  keyHint: z.string(),
  permissions: ApiKeyPermissionsSchema,
  isActive: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  usageCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ApiKeyResponseDto extends createZodDto(ApiKeyResponseSchema) {
  static create(apiKey: typeof apiKeys.$inferSelect): ApiKeyResponseDto {
    return {
      id: apiKey.id,
      name: apiKey.name,
      description: apiKey.description,
      keyPrefix: apiKey.keyPrefix,
      keyHint: apiKey.keyHint,
      permissions: apiKey.permissions,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
      usageCount: apiKey.usageCount,
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.updatedAt.toISOString(),
    };
  }
}

// Response schema for create endpoint - includes plainKey (one-time only)
export const CreateApiKeyResponseSchema = ApiKeyResponseSchema.extend({
  plainKey: z.string().describe('The plaintext API key (only returned on creation)'),
});

export class CreateApiKeyResponseDto extends createZodDto(CreateApiKeyResponseSchema) {}

// Response schema for delete endpoint
export const DeleteApiKeyResponseSchema = z.object({
  success: z.boolean(),
});

export class DeleteApiKeyResponseDto extends createZodDto(DeleteApiKeyResponseSchema) {}

export const ListApiKeysQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('50').transform(Number),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export class ListApiKeysQueryDto extends createZodDto(ListApiKeysQuerySchema) {}
