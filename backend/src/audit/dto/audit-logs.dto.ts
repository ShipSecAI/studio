import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AuditActorTypeSchema = z.enum(['user', 'api-key', 'internal', 'unknown']);
export const AuditResourceTypeSchema = z.enum([
  'workflow',
  'secret',
  'api_key',
  'webhook',
  'artifact',
  'analytics',
  'schedule',
  'mcp_server',
  'mcp_group',
  'human_input',
]);

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorType: AuditActorTypeSchema,
  actorDisplay: z.string().nullable(),
  action: z.string(),
  resourceType: AuditResourceTypeSchema,
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  // Note: provide explicit key schema to keep zod->json-schema conversion stable.
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export class AuditLogEntryDto extends createZodDto(AuditLogEntrySchema) {}

export const ListAuditLogsQuerySchema = z.object({
  resourceType: AuditResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .default('50')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 200, 'limit must be between 1 and 200'),
  cursor: z.string().optional(),
});

export class ListAuditLogsQueryDto extends createZodDto(ListAuditLogsQuerySchema) {}

export const ListAuditLogsResponseSchema = z.object({
  items: AuditLogEntrySchema.array(),
  nextCursor: z.string().nullable(),
});

export class ListAuditLogsResponseDto extends createZodDto(ListAuditLogsResponseSchema) {}
