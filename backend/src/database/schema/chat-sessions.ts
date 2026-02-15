import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const chatSessionsTable = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    title: text('title').notNull().default('New Conversation'),
    status: text('status').notNull().default('active'), // active | archived
    temporalWorkflowId: text('temporal_workflow_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_sessions_user_org_status_idx').on(table.userId, table.organizationId, table.status),
  ],
);

export type ChatSession = typeof chatSessionsTable.$inferSelect;
export type NewChatSession = typeof chatSessionsTable.$inferInsert;
