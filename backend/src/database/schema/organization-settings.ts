import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const organizationSettingsTable = pgTable('organization_settings', {
  organizationId: varchar('organization_id', { length: 191 }).primaryKey(),
  analyticsRetentionDays: integer('analytics_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettingsTable.$inferInsert;
