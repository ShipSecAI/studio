import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MAX_ANALYTICS_RETENTION_DAYS = 365;

export const AnalyticsSettingsResponseSchema = z.object({
  organizationId: z.string(),
  analyticsRetentionDays: z.number(),
  maxRetentionDays: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class AnalyticsSettingsResponseDto extends createZodDto(AnalyticsSettingsResponseSchema) {}

export const UpdateAnalyticsSettingsSchema = z.object({
  analyticsRetentionDays: z.number().int().min(1).max(MAX_ANALYTICS_RETENTION_DAYS).optional(),
});

export class UpdateAnalyticsSettingsDto extends createZodDto(UpdateAnalyticsSettingsSchema) {}
