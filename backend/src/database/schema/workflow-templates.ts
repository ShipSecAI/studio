import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const templateCategoryEnum = [
  'code-security',
  'cloud-security',
  'attack-surface',
  'notification',
] as const;

export type TemplateCategory = (typeof templateCategoryEnum)[number];

export const workflowTemplatesTable = pgTable('workflow_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 100 }).unique(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull().$type<TemplateCategory>(),
  graph: jsonb('graph').notNull(),
  icon: varchar('icon', { length: 50 }),
  screenshotUrl: varchar('screenshot_url', { length: 255 }),
  isFeatured: boolean('is_featured').notNull().default(false),
  runCount: integer('run_count').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowTemplate = typeof workflowTemplatesTable.$inferSelect;
export type NewWorkflowTemplate = typeof workflowTemplatesTable.$inferInsert;
