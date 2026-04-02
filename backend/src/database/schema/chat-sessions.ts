import { index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const chatSessionsTable = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    organizationId: varchar('organization_id', { length: 191 }),
    title: text('title').notNull().default('New Conversation'),
    status: text('status').notNull().default('active'), // active | archived
    processingStatus: text('processing_status').notNull().default('idle'), // idle | processing
    activeRunId: uuid('active_run_id'),
    activeTurnId: uuid('active_turn_id'),
    activeGenerationId: integer('active_generation_id').notNull().default(0),
    nextEventSeq: integer('next_event_seq').notNull().default(1),
    steerTargetTurnId: uuid('steer_target_turn_id'),
    steerRequestedAt: timestamp('steer_requested_at', { withTimezone: true }),
    temporalWorkflowId: text('temporal_workflow_id'),
    origin: text('origin').notNull().default('web'), // web | slack
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_sessions_user_org_status_idx').on(table.userId, table.organizationId, table.status),
  ],
);

export type ChatSession = typeof chatSessionsTable.$inferSelect;
export type NewChatSession = typeof chatSessionsTable.$inferInsert;
