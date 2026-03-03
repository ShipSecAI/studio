import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * GitHub App installations - stores info about orgs/users that installed the app
 */
export const githubAppInstallations = pgTable(
  'github_app_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GitHub's installation ID */
    installationId: integer('installation_id').notNull(),
    /** 'Organization' or 'User' */
    accountType: varchar('account_type', { length: 32 }).notNull(),
    /** GitHub username or org name */
    accountLogin: varchar('account_login', { length: 191 }).notNull(),
    /** GitHub account ID */
    accountId: integer('account_id').notNull(),
    /** Avatar URL */
    accountAvatarUrl: text('account_avatar_url'),
    /** Permissions granted to the app */
    permissions: jsonb('permissions').$type<Record<string, string>>().default({}),
    /** 'all' or 'selected' */
    repositorySelection: varchar('repository_selection', { length: 32 }).default('selected'),
    /** ShipSec organization that owns this installation */
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    /** User who initiated the installation */
    installedBy: varchar('installed_by', { length: 191 }),
    /** Whether the installation is active */
    isActive: boolean('is_active').default(true).notNull(),
    /** Suspended at timestamp (if suspended by GitHub) */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    installationIdIdx: uniqueIndex('github_installations_installation_id_uidx').on(
      table.installationId,
    ),
    orgIdx: index('github_installations_org_idx').on(table.organizationId),
    accountLoginIdx: index('github_installations_account_login_idx').on(table.accountLogin),
  }),
);

/**
 * GitHub repositories connected via installations
 */
export const githubRepositories = pgTable(
  'github_repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Reference to the installation */
    installationId: uuid('installation_id')
      .notNull()
      .references(() => githubAppInstallations.id, { onDelete: 'cascade' }),
    /** GitHub's repository ID */
    repoId: integer('repo_id').notNull(),
    /** Full name like 'owner/repo' */
    fullName: varchar('full_name', { length: 255 }).notNull(),
    /** Repository name only */
    name: varchar('name', { length: 191 }).notNull(),
    /** Owner login */
    owner: varchar('owner', { length: 191 }).notNull(),
    /** Whether the repo is private */
    isPrivate: boolean('is_private').default(false).notNull(),
    /** Default branch name */
    defaultBranch: varchar('default_branch', { length: 191 }).default('main'),
    /** Repository description */
    description: text('description'),
    /** Primary language */
    language: varchar('language', { length: 64 }),
    /** Clone URL (https) */
    cloneUrl: text('clone_url'),
    /** HTML URL */
    htmlUrl: text('html_url'),
    /** Star count from GitHub */
    starsCount: integer('stars_count').default(0).notNull(),
    /** Fork count from GitHub */
    forksCount: integer('forks_count').default(0).notNull(),
    /** ShipSec organization */
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    /** Whether scans are enabled for this repo */
    scansEnabled: boolean('scans_enabled').default(true).notNull(),
    /** Last synced from GitHub */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    repoIdIdx: uniqueIndex('github_repos_repo_id_uidx').on(table.repoId),
    installationIdx: index('github_repos_installation_idx').on(table.installationId),
    orgIdx: index('github_repos_org_idx').on(table.organizationId),
    fullNameIdx: index('github_repos_full_name_idx').on(table.fullName),
  }),
);

/**
 * Trigger rules for automated workflows on GitHub events
 */
export const githubTriggerRules = pgTable(
  'github_trigger_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-readable name */
    name: varchar('name', { length: 191 }).notNull(),
    /** Description of what this rule does */
    description: text('description'),
    /** Pattern to match repos: 'org/repo', 'org/*', or '*' */
    repositoryPattern: varchar('repository_pattern', { length: 255 }).notNull(),
    /** Event type: 'pull_request', 'push', 'release', 'repository_added' */
    event: varchar('event', { length: 64 }).notNull(),
    /** PR actions to trigger on: ['opened', 'synchronize', 'reopened'] */
    actions: jsonb('actions').$type<string[]>().default([]),
    /** Branch patterns to match: ['main', 'release/*'] */
    branches: jsonb('branches').$type<string[]>().default([]),
    /** Workflow ID to trigger */
    workflowId: uuid('workflow_id').notNull(),
    /** Whether to post results as PR comment */
    postPrComment: boolean('post_pr_comment').default(true).notNull(),
    /** Whether to create GitHub Check Run */
    createCheckRun: boolean('create_check_run').default(true).notNull(),
    /** Whether to post inline PR review comments */
    postPrReview: boolean('post_pr_review').default(false).notNull(),
    /** Severity threshold for failing the check run: 'critical','high','medium','low','info','none' */
    failOn: varchar('fail_on', { length: 32 }).default('high').notNull(),
    /** Whether this rule is enabled */
    enabled: boolean('enabled').default(true).notNull(),
    /** Priority for rule matching (lower = higher priority) */
    priority: integer('priority').default(100).notNull(),
    /** ShipSec organization */
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    /** User who created the rule */
    createdBy: varchar('created_by', { length: 191 }),
    /** Soft delete timestamp */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('github_trigger_rules_org_idx').on(table.organizationId),
    eventIdx: index('github_trigger_rules_event_idx').on(table.event),
    enabledIdx: index('github_trigger_rules_enabled_idx').on(table.enabled),
  }),
);

/**
 * Scan results linked to GitHub PRs/commits
 */
export const githubScanResults = pgTable(
  'github_scan_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Reference to the repository */
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id, { onDelete: 'cascade' }),
    /** ShipSec workflow run ID */
    workflowRunId: varchar('workflow_run_id', { length: 191 }).notNull(),
    /** Source type: 'pr', 'push', 'manual', 'schedule' */
    sourceType: varchar('source_type', { length: 32 }).notNull(),
    /** PR number (if PR scan) */
    prNumber: integer('pr_number'),
    /** Branch name */
    branch: varchar('branch', { length: 191 }),
    /** Commit SHA */
    commitSha: varchar('commit_sha', { length: 64 }),
    /** Scan status: 'pending', 'running', 'success', 'failure', 'error' */
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    /** Summary of findings */
    summary: jsonb('summary')
      .$type<{
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
      }>()
      .default({ critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
    /** Total findings count */
    findingsCount: integer('findings_count').default(0).notNull(),
    /** Detailed findings from the scan */
    findings: jsonb('findings')
      .$type<
        {
          id: string;
          type: string;
          severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
          file: string;
          line?: number;
          endLine?: number;
          message: string;
          snippet?: string;
          ruleId?: string;
          category?: string;
        }[]
      >()
      .default([]),
    /** GitHub Check Run ID (if created) */
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    /** GitHub PR comment ID (if posted) */
    prCommentId: bigint('pr_comment_id', { mode: 'number' }),
    /** GitHub PR review ID (if posted) */
    prReviewId: bigint('pr_review_id', { mode: 'number' }),
    /** External URL to full results */
    resultsUrl: text('results_url'),
    /** Error message if scan failed */
    errorMessage: text('error_message'),
    /** Trigger rule that initiated this scan */
    triggerRuleId: uuid('trigger_rule_id').references(() => githubTriggerRules.id, {
      onDelete: 'set null',
    }),
    /** ShipSec organization */
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    /** Started at */
    startedAt: timestamp('started_at', { withTimezone: true }),
    /** Completed at */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    repoIdx: index('github_scan_results_repo_idx').on(table.repositoryId),
    orgIdx: index('github_scan_results_org_idx').on(table.organizationId),
    prIdx: index('github_scan_results_pr_idx').on(table.repositoryId, table.prNumber),
    statusIdx: index('github_scan_results_status_idx').on(table.status),
    workflowRunIdx: index('github_scan_results_workflow_run_idx').on(table.workflowRunId),
    triggerRuleIdx: index('github_scan_results_trigger_rule_idx').on(
      table.triggerRuleId,
      table.createdAt,
    ),
  }),
);

// Type exports
export type GitHubAppInstallationRecord = typeof githubAppInstallations.$inferSelect;
export type NewGitHubAppInstallationRecord = typeof githubAppInstallations.$inferInsert;

export type GitHubRepositoryRecord = typeof githubRepositories.$inferSelect;
export type NewGitHubRepositoryRecord = typeof githubRepositories.$inferInsert;

export type GitHubTriggerRuleRecord = typeof githubTriggerRules.$inferSelect;
export type NewGitHubTriggerRuleRecord = typeof githubTriggerRules.$inferInsert;

export type GitHubScanResultRecord = typeof githubScanResults.$inferSelect;
export type NewGitHubScanResultRecord = typeof githubScanResults.$inferInsert;
