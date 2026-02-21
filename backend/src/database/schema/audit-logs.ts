import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export type AuditActorType = 'user' | 'api-key' | 'internal' | 'unknown';

export type AuditResourceType =
  | 'workflow'
  | 'secret'
  | 'api_key'
  | 'webhook'
  | 'artifact'
  | 'analytics'
  | 'schedule'
  | 'mcp_server'
  | 'mcp_group'
  | 'human_input';

export const auditLogsTable = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }),
    actorId: varchar('actor_id', { length: 191 }),
    actorType: varchar('actor_type', { length: 32 }).$type<AuditActorType>().notNull(),
    actorDisplay: varchar('actor_display', { length: 191 }),
    action: varchar('action', { length: 64 }).notNull(),
    resourceType: varchar('resource_type', { length: 32 }).$type<AuditResourceType>().notNull(),
    resourceId: varchar('resource_id', { length: 191 }),
    resourceName: varchar('resource_name', { length: 191 }),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>().default(null),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedAtIdx: index('audit_logs_org_created_at_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    resourceIdx: index('audit_logs_org_resource_idx').on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
    actionIdx: index('audit_logs_org_action_created_at_idx').on(
      table.organizationId,
      table.action,
      table.createdAt,
    ),
    actorIdx: index('audit_logs_org_actor_created_at_idx').on(
      table.organizationId,
      table.actorId,
      table.createdAt,
    ),
  }),
);

export type AuditLogRecord = typeof auditLogsTable.$inferSelect;
export type AuditLogInsert = typeof auditLogsTable.$inferInsert;
