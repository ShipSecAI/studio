import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { chatSessionsTable } from './chat-sessions';

export const slackThreadMappingsTable = pgTable(
  'slack_thread_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    slackTeamId: text('slack_team_id').notNull(),
    slackChannelId: text('slack_channel_id').notNull(),
    slackThreadTs: text('slack_thread_ts').notNull(),
    connectionId: uuid('connection_id').notNull(),
    botUserId: text('bot_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('slack_thread_mappings_thread_uidx').on(
      table.slackTeamId,
      table.slackChannelId,
      table.slackThreadTs,
    ),
    index('slack_thread_mappings_session_idx').on(table.sessionId),
  ],
);

export type SlackThreadMapping = typeof slackThreadMappingsTable.$inferSelect;
export type NewSlackThreadMapping = typeof slackThreadMappingsTable.$inferInsert;
