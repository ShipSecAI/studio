import { jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Human input status enum
 */
export const humanInputStatusEnum = pgEnum('human_input_status', [
  'pending',
  'resolved',
  'expired',
  'cancelled',
]);

/**
 * Human input type enum - the kind of input expected from the human
 */
export const humanInputTypeEnum = pgEnum('human_input_type', [
  'approval',   // Simple yes/no decision
  'form',       // Structured form with fields
  'selection',  // Choose from options
  'review',     // Review and optionally edit content
  'acknowledge', // Simple acknowledgment
]);

/**
 * Human Input Requests table - generalized Human-in-the-Loop (HITL) system
 */
export const humanInputRequests = pgTable('human_input_requests', {
  // Primary key
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Workflow context
  runId: text('run_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  nodeRef: text('node_ref').notNull(),
  
  // Status
  status: humanInputStatusEnum('status').notNull().default('pending'),
  
  // Input type and schema
  inputType: humanInputTypeEnum('input_type').notNull().default('approval'),
  inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().default({}),
  
  // Display metadata
  title: text('title').notNull(),
  description: text('description'),
  context: jsonb('context').$type<Record<string, unknown>>().default({}),
  
  // Secure token for public links
  resolveToken: text('resolve_token').notNull().unique(),
  
  // Timeout handling
  timeoutAt: timestamp('timeout_at', { withTimezone: true }),
  
  // Response tracking  
  responseData: jsonb('response_data').$type<Record<string, unknown>>(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  respondedBy: text('responded_by'),
  
  // Multi-tenancy
  organizationId: varchar('organization_id', { length: 191 }),
  
  // Audit timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type HumanInputRequest = typeof humanInputRequests.$inferSelect;
export type HumanInputRequestInsert = typeof humanInputRequests.$inferInsert;
