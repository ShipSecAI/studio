import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chatSessionsTable } from './chat-sessions';

export const chatPartialResponsesTable = pgTable('chat_partial_responses', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
  parts: jsonb('parts').notNull().$type<unknown[]>().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ChatPartialResponse = typeof chatPartialResponsesTable.$inferSelect;
