import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});

export const BatchRunSummariesRequestSchema = z.object({
  runIds: z.array(z.string().trim().min(1)).max(100),
});

export class BatchRunSummariesRequestDto extends createZodDto(BatchRunSummariesRequestSchema) {}

export const BatchRunSummariesResponseSchema = z.object({
  summaries: z.record(z.string(), SeverityCountsSchema),
});

export class BatchRunSummariesResponseDto extends createZodDto(BatchRunSummariesResponseSchema) {}

export const EnsureTenantRequestSchema = z.object({
  organizationId: z.string().trim().min(1),
});

export class EnsureTenantRequestDto extends createZodDto(EnsureTenantRequestSchema) {}

export const EnsureTenantResponseSchema = z.object({
  success: z.boolean(),
  securityEnabled: z.boolean(),
  message: z.string(),
});

export class EnsureTenantResponseDto extends createZodDto(EnsureTenantResponseSchema) {}
