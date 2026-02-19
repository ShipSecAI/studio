import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { ExecutionInputPreview } from '@shipsec/shared';

export const workflowRunsTable = pgTable(
  'workflow_runs',
  {
    runId: text('run_id').primaryKey(),
    workflowId: uuid('workflow_id').notNull(),
    workflowVersionId: uuid('workflow_version_id'),
    workflowVersion: integer('workflow_version'),
    temporalRunId: text('temporal_run_id'),
    parentRunId: text('parent_run_id'),
    parentNodeRef: text('parent_node_ref'),
    totalActions: integer('total_actions').notNull().default(0),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    triggerType: text('trigger_type').notNull().default('manual'),
    triggerSource: text('trigger_source'),
    triggerLabel: text('trigger_label').notNull().default('Manual run'),
    inputPreview: jsonb('input_preview')
      .$type<ExecutionInputPreview>()
      .notNull()
      .default({ runtimeInputs: {}, nodeOverrides: {} }),
    organizationId: varchar('organization_id', { length: 191 }),
    status: text('status'),
    closeTime: timestamp('close_time', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Speeds up the correlated subquery in workflows.listSummary that fetches the
    // latest run status per workflow (ORDER BY created_at DESC LIMIT 1).
    index('idx_workflow_runs_workflow_created').on(table.workflowId, table.createdAt),
    // Speeds up the activity aggregation query (WHERE organization_id = ? AND created_at >= ?)
    index('idx_workflow_runs_org_created').on(table.organizationId, table.createdAt),
  ],
);

export type WorkflowRunRecord = typeof workflowRunsTable.$inferSelect;
export type WorkflowRunInsert = typeof workflowRunsTable.$inferInsert;
