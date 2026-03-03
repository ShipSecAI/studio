import { boolean, index, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const userPreferencesTable = pgTable(
  'user_preferences',
  {
    userId: varchar('user_id', { length: 191 }).notNull(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    hasCompletedOnboarding: boolean('has_completed_onboarding').notNull().default(false),
    hasCompletedBuilderTour: boolean('has_completed_builder_tour').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.organizationId] }),
    orgIdx: index('user_preferences_org_idx').on(table.organizationId),
  }),
);

export type UserPreferences = typeof userPreferencesTable.$inferSelect;
export type NewUserPreferences = typeof userPreferencesTable.$inferInsert;
