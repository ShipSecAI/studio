import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const securityWikiConfigs = pgTable(
  'security_wiki_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull().default('local'),
    repoOwner: varchar('repo_owner', { length: 191 }),
    repoName: varchar('repo_name', { length: 191 }).notNull(),
    repoUrl: text('repo_url'),
    localPath: text('local_path'),
    defaultBranch: varchar('default_branch', { length: 191 }).notNull().default('main'),
    rootPath: text('root_path').notNull().default('/'),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    pathPolicy: jsonb('path_policy').$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgActiveUnique: uniqueIndex('security_wiki_configs_org_active_uidx').on(
      table.organizationId,
      table.status,
    ),
    orgIdx: index('security_wiki_configs_org_idx').on(table.organizationId),
  }),
);

export const securityWikiRuns = pgTable(
  'security_wiki_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    wikiConfigId: uuid('wiki_config_id')
      .notNull()
      .references(() => securityWikiConfigs.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 191 }).notNull(),
    agentName: varchar('agent_name', { length: 191 }).notNull(),
    repoSlug: varchar('repo_slug', { length: 255 }).notNull(),
    repoPath: text('repo_path'),
    repoCommit: varchar('repo_commit', { length: 128 }),
    model: varchar('model', { length: 191 }),
    branchName: varchar('branch_name', { length: 255 }),
    wikiBaseCommit: varchar('wiki_base_commit', { length: 128 }),
    outputCommit: varchar('output_commit', { length: 128 }),
    mergeCommit: varchar('merge_commit', { length: 128 }),
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    changedFiles: jsonb('changed_files').$type<string[]>().notNull().default([]),
    validation: jsonb('validation').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    orgRunUnique: uniqueIndex('security_wiki_runs_org_run_uidx').on(
      table.organizationId,
      table.runId,
    ),
    orgCreatedIdx: index('security_wiki_runs_org_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    configIdx: index('security_wiki_runs_config_idx').on(table.wikiConfigId),
  }),
);

export type SecurityWikiConfig = typeof securityWikiConfigs.$inferSelect;
export type NewSecurityWikiConfig = typeof securityWikiConfigs.$inferInsert;
export type SecurityWikiRun = typeof securityWikiRuns.$inferSelect;
export type NewSecurityWikiRun = typeof securityWikiRuns.$inferInsert;
