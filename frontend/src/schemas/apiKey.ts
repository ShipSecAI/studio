import { z } from 'zod';

export const CreateApiKeyInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(191),
  description: z.string().optional(),
  permissions: z.object({
    workflows: z.object({
      run: z.boolean().default(false),
      list: z.boolean().default(false),
      read: z.boolean().default(false),
    }),
    runs: z.object({
      read: z.boolean().default(false),
      cancel: z.boolean().default(false),
    }),
  }),
  expiresAt: z.string().optional(), // ISO date string
  rateLimit: z.number().int().positive().optional(),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const UpdateApiKeyInputSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().optional(),
  permissions: z.object({
    workflows: z.object({
      run: z.boolean().optional(),
      list: z.boolean().optional(),
      read: z.boolean().optional(),
    }),
    runs: z.object({
      read: z.boolean().optional(),
      cancel: z.boolean().optional(),
    }),
  }).optional(),
  isActive: z.boolean().optional(),
  rateLimit: z.number().int().positive().nullable().optional(),
});

export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeyInputSchema>;
