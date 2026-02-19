import { boolean, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const subscriptionPlansTable = pgTable('subscription_plans', {
  id: varchar('id', { length: 50 }).primaryKey(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  priceUsdCents: integer('price_usd_cents').notNull(),
  workflowRunsPerMonth: integer('workflow_runs_per_month').notNull(),
  aiBudgetUsdCents: integer('ai_budget_usd_cents').notNull(),
  maxConcurrentRuns: integer('max_concurrent_runs').notNull(),
  analyticsRetentionDays: integer('analytics_retention_days').notNull(),
  maxWorkflows: integer('max_workflows').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;
