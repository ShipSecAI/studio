import { z } from 'zod';

export const SecretVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  createdBy: z.string().nullable().optional(),
});

export type SecretVersion = z.infer<typeof SecretVersionSchema>;

export const SecretSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeVersion: SecretVersionSchema.nullable().optional(),
});

export type SecretSummary = z.infer<typeof SecretSummarySchema>;

export const SecretValueSchema = z.object({
  secretId: z.string().uuid(),
  version: z.number().int().positive(),
  value: z.string(),
});

export type SecretValue = z.infer<typeof SecretValueSchema>;

export const CreateSecretInputSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateSecretInput = z.infer<typeof CreateSecretInputSchema>;

export const RotateSecretInputSchema = z.object({
  value: z.string().min(1),
});

export type RotateSecretInput = z.infer<typeof RotateSecretInputSchema>;

export const UpdateSecretInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateSecretInput = z.infer<typeof UpdateSecretInputSchema>;
