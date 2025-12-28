import { jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Approval request status enum
 */
export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved', 
  'rejected',
  'expired',
  'cancelled',
]);

/**
 * Approval requests table - stores human-in-the-loop approval gates
 */
export const approvalRequestsTable = pgTable('approval_requests', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Workflow context
  runId: text('run_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  nodeRef: text('node_ref').notNull(),
  
  // Status
  status: approvalStatusEnum('status').notNull().default('pending'),
  
  // Approval metadata
  title: text('title').notNull(),
  description: text('description'),
  context: jsonb('context').$type<Record<string, unknown>>().default({}),
  
  // Secure one-time tokens for public links
  approveToken: text('approve_token').notNull().unique(),
  rejectToken: text('reject_token').notNull().unique(),
  
  // Timeout handling
  timeoutAt: timestamp('timeout_at', { withTimezone: true }),
  
  // Response tracking
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  respondedBy: text('responded_by'),
  responseNote: text('response_note'),
  
  // Multi-tenancy
  organizationId: varchar('organization_id', { length: 191 }),
  
  // Audit timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
export type ApprovalRequestInsert = typeof approvalRequestsTable.$inferInsert;
