import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { chatSessionsTable } from './chat-sessions';
import { chatTurnsTable } from './chat-turns';

export const chatSessionEventsTable = pgTable(
  'chat_session_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => chatTurnsTable.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    generationId: text('generation_id'),
    eventId: text('event_id').notNull(),
    seq: integer('seq').notNull(),
    chunk: jsonb('chunk').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chat_session_events_session_seq_uidx').on(table.sessionId, table.seq),
    uniqueIndex('chat_session_events_turn_event_uidx').on(table.turnId, table.eventId),
    index('chat_session_events_session_seq_idx').on(table.sessionId, table.seq),
  ],
);

export type ChatSessionEvent = typeof chatSessionEventsTable.$inferSelect;
export type NewChatSessionEvent = typeof chatSessionEventsTable.$inferInsert;
