import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const workflowRunsTable = pgTable('workflow_runs', {
  runId: text('run_id').primaryKey(),
  workflowId: uuid('workflow_id').notNull(),
  triggerType: text('trigger_type').notNull(),
  workflowVersionId: uuid('workflow_version_id'),
  workflowVersion: integer('workflow_version'),
  temporalRunId: text('temporal_run_id'),
  totalActions: integer('total_actions').notNull().default(0),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
  organizationId: varchar('organization_id', { length: 191 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowRunRecord = typeof workflowRunsTable.$inferSelect;
export type WorkflowRunInsert = typeof workflowRunsTable.$inferInsert;
