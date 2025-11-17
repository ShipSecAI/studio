import { bigserial, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const workflowTerminalRecordsTable = pgTable('workflow_terminal_records', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: text('run_id').notNull(),
  workflowId: text('workflow_id').notNull(),
  workflowVersionId: text('workflow_version_id'),
  nodeRef: text('node_ref').notNull(),
  stream: text('stream').notNull(),
  fileId: uuid('file_id').notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  firstChunkIndex: integer('first_chunk_index'),
  lastChunkIndex: integer('last_chunk_index'),
  organizationId: varchar('organization_id', { length: 191 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type WorkflowTerminalRecord = typeof workflowTerminalRecordsTable.$inferSelect;
export type WorkflowTerminalRecordInsert = typeof workflowTerminalRecordsTable.$inferInsert;
