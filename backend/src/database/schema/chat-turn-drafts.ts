import { integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { chatTurnsTable } from './chat-turns';

export const chatTurnDraftsTable = pgTable('chat_turn_drafts', {
  turnId: uuid('turn_id')
    .primaryKey()
    .references(() => chatTurnsTable.id, { onDelete: 'cascade' }),
  assistantMessageSnapshot: jsonb('assistant_message_snapshot')
    .notNull()
    .$type<Record<string, unknown>>()
    .default({}),
  lastSeq: integer('last_seq').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ChatTurnDraft = typeof chatTurnDraftsTable.$inferSelect;
