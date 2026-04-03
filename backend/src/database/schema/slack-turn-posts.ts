import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chatSessionsTable } from './chat-sessions';
import { chatTurnsTable } from './chat-turns';

export const slackTurnPostsTable = pgTable(
  'slack_turn_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => chatTurnsTable.id, { onDelete: 'cascade' })
      .unique(),
    primaryMessageTs: text('primary_message_ts'),
    continuationMessageTs: jsonb('continuation_message_ts').$type<string[]>().notNull().default([]),
    lastContentHash: text('last_content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('slack_turn_posts_session_idx').on(table.sessionId),
    index('slack_turn_posts_turn_idx').on(table.turnId),
  ],
);

export type SlackTurnPost = typeof slackTurnPostsTable.$inferSelect;
export type NewSlackTurnPost = typeof slackTurnPostsTable.$inferInsert;
