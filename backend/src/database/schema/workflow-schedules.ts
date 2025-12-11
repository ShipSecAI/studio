import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import type { ScheduleInputPayload } from '@shipsec/shared';

export const workflowSchedulesTable = pgTable('workflow_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull(),
  workflowVersionId: uuid('workflow_version_id'),
  workflowVersion: integer('workflow_version'),
  name: text('name').notNull(),
  description: text('description'),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').notNull(),
  humanLabel: text('human_label'),
  overlapPolicy: text('overlap_policy').notNull().default('skip'),
  catchupWindowSeconds: integer('catchup_window_seconds').notNull().default(0),
  status: text('status').notNull().default('active'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  inputPayload: jsonb('input_payload')
    .$type<ScheduleInputPayload>()
    .notNull()
    .default({ runtimeInputs: {}, nodeOverrides: {} }),
  temporalScheduleId: text('temporal_schedule_id'),
  temporalSnapshot: jsonb('temporal_snapshot')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  organizationId: varchar('organization_id', { length: 191 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowScheduleRecord = typeof workflowSchedulesTable.$inferSelect;
export type WorkflowScheduleInsert = typeof workflowSchedulesTable.$inferInsert;
