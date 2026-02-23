import { bigserial, index, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chatSessionsTable } from './chat-sessions';

export const chatStreamEventsTable = pgTable(
  'chat_stream_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    seq: integer('seq').notNull(),
    event: jsonb('event').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_stream_events_session_run_seq_idx').on(table.sessionId, table.runId, table.seq),
  ],
);

export type ChatStreamEvent = typeof chatStreamEventsTable.$inferSelect;
