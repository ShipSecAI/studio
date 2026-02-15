import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { chatSessionsTable } from './chat-sessions';

export const chatMessagesTable = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | assistant | system
    parts: jsonb('parts').notNull().$type<unknown[]>(), // UIMessage.parts array
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('chat_messages_session_created_idx').on(table.sessionId, table.createdAt)],
);

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type NewChatMessage = typeof chatMessagesTable.$inferInsert;
