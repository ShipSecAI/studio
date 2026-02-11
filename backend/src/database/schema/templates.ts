import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { z } from 'zod';

/**
 * Templates table - stores workflow template metadata
 * Templates are synced from GitHub repository
 */
export const templatesTable = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  tags: jsonb('tags').$type<string[]>().default([]),
  author: varchar('author', { length: 255 }),
  // GitHub repository info
  repository: varchar('repository', { length: 255 }).notNull(), // e.g., "org/templates"
  path: varchar('path', { length: 500 }).notNull(), // Path to template in repo
  branch: varchar('branch', { length: 100 }).default('main'),
  version: varchar('version', { length: 50 }), // Optional version tag
  commitSha: varchar('commit_sha', { length: 100 }),
  // Template content
  manifest: jsonb('manifest').$type<TemplateManifest>().notNull(),
  graph: jsonb('graph').$type<Record<string, unknown>>(), // Sanitized workflow graph
  requiredSecrets: jsonb('required_secrets').$type<RequiredSecret[]>().default([]),
  // Stats and flags
  popularity: integer('popularity').notNull().default(0),
  isOfficial: boolean('is_official').notNull().default(false),
  isVerified: boolean('is_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Template submissions table - tracks PR-based template submissions
 */
export const templatesSubmissionsTable = pgTable('templates_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateName: varchar('template_name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  repository: varchar('repository', { length: 255 }).notNull(),
  branch: varchar('branch', { length: 100 }),
  path: varchar('path', { length: 500 }).notNull(),
  commitSha: varchar('commit_sha', { length: 100 }),
  pullRequestNumber: integer('pr_number'),
  pullRequestUrl: varchar('pr_url', { length: 500 }),
  status: varchar('status', { length: 50 })
    .notNull()
    .default('pending'), // pending, approved, rejected, merged
  submittedBy: varchar('submitted_by', { length: 191 }).notNull(),
  organizationId: varchar('organization_id', { length: 191 }),
  manifest: jsonb('manifest').$type<TemplateManifest>(),
  graph: jsonb('graph').$type<Record<string, unknown>>(),
  feedback: text('feedback'),
  reviewedBy: varchar('reviewed_by', { length: 191 }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Zod schemas for validation
export const RequiredSecretSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
});

export const TemplateManifestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requiredSecrets: z.array(RequiredSecretSchema).optional(),
  entryPoint: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  documentation: z.string().optional(),
});

// Type exports
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
export type RequiredSecret = z.infer<typeof RequiredSecretSchema>;

export type Template = typeof templatesTable.$inferSelect;
export type NewTemplate = typeof templatesTable.$inferInsert;

export type TemplateSubmission = typeof templatesSubmissionsTable.$inferSelect;
export type NewTemplateSubmission = typeof templatesSubmissionsTable.$inferInsert;
