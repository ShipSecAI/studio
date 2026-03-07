import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { AuditJsonObject, AuditJsonPrimitive } from '../../database/schema/audit-logs';

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

const AuditJsonPrimitiveSchema: z.ZodType<AuditJsonPrimitive> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const AuditJsonObjectSchema: z.ZodType<AuditJsonObject> = z.record(
  z.string(),
  AuditJsonPrimitiveSchema,
);

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
  metadata: AuditJsonObjectSchema.nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export class AuditLogEntryDto extends createZodDto(AuditLogEntrySchema) {}

export const ListAuditLogsQuerySchema = z.object({
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export class ListAuditLogsQueryDto extends createZodDto(ListAuditLogsQuerySchema) {}
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

export const ListAuditLogsResponseSchema = z.object({
  items: AuditLogEntrySchema.array(),
  nextCursor: z.string().nullable(),
});

export class ListAuditLogsResponseDto extends createZodDto(ListAuditLogsResponseSchema) {}
