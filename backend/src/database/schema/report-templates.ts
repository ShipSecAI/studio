import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const reportTemplateStatusEnum = ['draft', 'published', 'archived'] as const;
export type ReportTemplateStatus = (typeof reportTemplateStatusEnum)[number];

export const reportTemplateScopeEnum = ['builtin', 'organization'] as const;
export type ReportTemplateScope = (typeof reportTemplateScopeEnum)[number];

export const reportTemplateVisibilityEnum = ['chat_only', 'library'] as const;
export type ReportTemplateVisibility = (typeof reportTemplateVisibilityEnum)[number];

export const reportTemplateVersionKindEnum = ['draft', 'published'] as const;
export type ReportTemplateVersionKind = (typeof reportTemplateVersionKindEnum)[number];

export const reportTemplatesTable = pgTable('report_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: varchar('organization_id', { length: 191 }),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 120 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 80 }).notNull(),
  status: varchar('status', { length: 20 }).$type<ReportTemplateStatus>().notNull(),
  scope: varchar('scope', { length: 20 }).$type<ReportTemplateScope>().notNull(),
  visibility: varchar('visibility', { length: 20 }).$type<ReportTemplateVisibility>().notNull(),
  createdBy: varchar('created_by', { length: 191 }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedVersionId: uuid('published_version_id'),
  draftVersionId: uuid('draft_version_id'),
  draftSessionId: uuid('draft_session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const reportTemplateVersionsTable = pgTable('report_template_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  kind: varchar('kind', { length: 20 }).$type<ReportTemplateVersionKind>().notNull(),
  name: text('name').notNull(),
  description: text('description'),
  htmlTemplate: text('html_template').notNull(),
  css: text('css').notNull().default(''),
  inputSchema: jsonb('input_schema').notNull().default({}),
  sampleData: jsonb('sample_data').notNull().default({}),
  createdBy: varchar('created_by', { length: 191 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ReportTemplate = typeof reportTemplatesTable.$inferSelect;
export type NewReportTemplate = typeof reportTemplatesTable.$inferInsert;
export type ReportTemplateVersion = typeof reportTemplateVersionsTable.$inferSelect;
export type NewReportTemplateVersion = typeof reportTemplateVersionsTable.$inferInsert;
