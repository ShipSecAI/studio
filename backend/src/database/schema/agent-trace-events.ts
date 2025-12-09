import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const agentTraceEventsTable = pgTable(
  'agent_trace_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentRunId: text('agent_run_id').notNull(),
    workflowRunId: text('workflow_run_id').notNull(),
    nodeRef: text('node_ref').notNull(),
    sequence: integer('sequence').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    partType: text('part_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentRunIdx: index('agent_trace_events_run_idx').on(table.agentRunId, table.sequence),
    workflowRunIdx: index('agent_trace_events_workflow_idx').on(table.workflowRunId),
  }),
);

export type AgentTraceEventRecord = typeof agentTraceEventsTable.$inferSelect;
