import { bigserial, index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const workflowTraces = pgTable(
  'workflow_traces',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    workflowId: text('workflow_id'),
    organizationId: varchar('organization_id', { length: 191 }),
    type: text('type')
      .$type<'NODE_STARTED' | 'NODE_COMPLETED' | 'NODE_FAILED' | 'NODE_PROGRESS' | 'AWAITING_INPUT' | 'NODE_SKIPPED'>()
      .notNull(),
    nodeRef: text('node_ref').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    message: text('message'),
    error: jsonb('error'),
    outputSummary: jsonb('output_summary'),
    level: text('level').notNull().default('info'),
    data: jsonb('data'),
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runIndex: index('workflow_traces_run_idx').on(table.runId, table.sequence),
  }),
);

export type WorkflowTraceInsert = typeof workflowTraces.$inferInsert;
