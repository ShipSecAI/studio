import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export const organizationSettingsTable = pgTable('organization_settings', {
  organizationId: varchar('organization_id', { length: 191 }).primaryKey(),
  subscriptionTier: varchar('subscription_tier', { length: 50 })
    .$type<SubscriptionTier>()
    .notNull()
    .default('free'),
  analyticsRetentionDays: integer('analytics_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettingsTable.$inferInsert;
