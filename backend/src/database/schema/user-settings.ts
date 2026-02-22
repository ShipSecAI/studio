import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const userSettingsTable = pgTable('user_settings', {
  userId: varchar('user_id', { length: 191 }).primaryKey(),
  awsExternalId: text('aws_external_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type UserSettings = typeof userSettingsTable.$inferSelect;
export type NewUserSettings = typeof userSettingsTable.$inferInsert;
