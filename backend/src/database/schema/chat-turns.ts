import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { chatSessionsTable } from './chat-sessions';

export const chatTurnsTable = pgTable(
  'chat_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    clientMessageId: text('client_message_id'),
    userMessage: text('user_message').notNull(),
    status: text('status').notNull().default('queued'),
    runId: uuid('run_id'),
    generationId: text('generation_id'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_turns_session_queued_idx').on(table.sessionId, table.queuedAt),
    uniqueIndex('chat_turns_session_client_message_uidx')
      .on(table.sessionId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    uniqueIndex('chat_turns_one_running_per_session_uidx')
      .on(table.sessionId)
      .where(sql`${table.status} = 'running'`),
    check(
      'chat_turns_status_check',
      sql`${table.status} in ('queued','running','completed','interrupted','failed','cancelled')`,
    ),
  ],
);

export type ChatTurn = typeof chatTurnsTable.$inferSelect;
export type NewChatTurn = typeof chatTurnsTable.$inferInsert;
