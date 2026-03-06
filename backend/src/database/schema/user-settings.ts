import { boolean, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const userSettingsTable = pgTable('user_settings', {
  userId: varchar('user_id', { length: 191 }).primaryKey(),
  awsExternalId: text('aws_external_id'),
  appNavigationTourCompleted: boolean('app_navigation_tour_completed').notNull().default(false),
  workflowBuilderTourCompleted: boolean('workflow_builder_tour_completed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type NewUserSettings = typeof userSettingsTable.$inferInsert;
