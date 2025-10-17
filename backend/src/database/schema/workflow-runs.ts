import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workflowRunsTable = pgTable('workflow_runs', {
  runId: text('run_id').primaryKey(),
  workflowId: uuid('workflow_id').notNull(),
  temporalRunId: text('temporal_run_id'),
  totalActions: integer('total_actions').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowRunRecord = typeof workflowRunsTable.$inferSelect;
export type WorkflowRunInsert = typeof workflowRunsTable.$inferInsert;
