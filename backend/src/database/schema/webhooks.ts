import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const webhookConfigurationsTable = pgTable('webhook_configurations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull(),
  workflowVersionId: uuid('workflow_version_id'),
  workflowVersion: integer('workflow_version'),
  name: text('name').notNull(),
  description: text('description'),
  webhookPath: varchar('webhook_path', { length: 255 }).notNull().unique(),
  parsingScript: text('parsing_script').notNull(),
  expectedInputs: jsonb('expected_inputs').notNull().$type<
    {
      id: string;
      label: string;
      type: 'text' | 'number' | 'json' | 'array' | 'file';
      required: boolean;
      description?: string;
    }[]
  >(),
  status: text('status').notNull().default('active').$type<'active' | 'inactive'>(),
  organizationId: varchar('organization_id', { length: 191 }),
  createdBy: varchar('created_by', { length: 191 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const webhookDeliveriesTable = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id')
    .notNull()
    .references(() => webhookConfigurationsTable.id, { onDelete: 'cascade' }),
  workflowRunId: text('workflow_run_id'),
  status: text('status')
    .notNull()
    .default('processing')
    .$type<'processing' | 'delivered' | 'failed'>(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  headers: jsonb('headers').$type<Record<string, string> | undefined>(),
  parsedData: jsonb('parsed_data').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type WebhookConfigurationRecord = typeof webhookConfigurationsTable.$inferSelect;
export type WebhookConfigurationInsert = typeof webhookConfigurationsTable.$inferInsert;
export type WebhookDeliveryRecord = typeof webhookDeliveriesTable.$inferSelect;
export type WebhookDeliveryInsert = typeof webhookDeliveriesTable.$inferInsert;
