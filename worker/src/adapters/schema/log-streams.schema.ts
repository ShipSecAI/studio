import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const workflowLogStreams = pgTable(
  'workflow_log_streams',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id').notNull(),
    nodeRef: text('node_ref').notNull(),
    stream: text('stream').$type<'stdout' | 'stderr' | 'console'>().notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    labels: jsonb('labels').notNull(),
    firstTimestamp: timestamp('first_timestamp', { withTimezone: true }).notNull(),
    lastTimestamp: timestamp('last_timestamp', { withTimezone: true }).notNull(),
    lineCount: integer('line_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    runNodeStreamIdx: uniqueIndex('workflow_log_streams_run_node_stream_idx').on(
      table.runId,
      table.nodeRef,
      table.stream,
    ),
    runNodeStreamUnique: uniqueIndex('workflow_log_streams_run_node_stream_uidx').on(
      table.runId,
      table.nodeRef,
      table.stream,
    ),
  }),
);

export type WorkflowLogStreamInsert = typeof workflowLogStreams.$inferInsert;
export type WorkflowLogStreamRecord = typeof workflowLogStreams.$inferSelect;
