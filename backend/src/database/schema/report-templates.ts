import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const reportTemplates = pgTable(
  'report_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    content: jsonb('content').notNull(),
    inputSchema: jsonb('input_schema').notNull(),
    sampleData: jsonb('sample_data'),
    version: integer('version').notNull().default(1),
    isSystem: boolean('is_system').notNull().default(false),
    createdBy: varchar('created_by', { length: 191 }),
    orgId: varchar('org_id', { length: 191 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('report_templates_org_idx').on(table.orgId),
    systemIdx: index('report_templates_system_idx').on(table.isSystem),
  }),
);

export const generatedReports = pgTable(
  'generated_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id'),
    templateVersion: integer('template_version'),
    workflowRunId: uuid('workflow_run_id'),
    inputData: jsonb('input_data'),
    artifactId: uuid('artifact_id'),
    orgId: varchar('org_id', { length: 191 }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    templateIdx: index('generated_reports_template_idx').on(table.templateId),
    workflowIdx: index('generated_reports_workflow_idx').on(table.workflowRunId),
  }),
);

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type NewReportTemplate = typeof reportTemplates.$inferInsert;
export type GeneratedReport = typeof generatedReports.$inferSelect;
export type NewGeneratedReport = typeof generatedReports.$inferInsert;
