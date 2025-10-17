import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { TraceEventType } from '../../trace/types';

export const workflowTracesTable = pgTable(
  'workflow_traces',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    workflowId: text('workflow_id'),
    type: text('type').$type<TraceEventType>().notNull(),
    nodeRef: text('node_ref').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    message: text('message'),
    error: text('error'),
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

export type WorkflowTraceRecord = typeof workflowTracesTable.$inferSelect;
