import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../adapters/schema';

/**
 * Approval request creation input
 */
export interface CreateApprovalRequestInput {
  runId: string;
  workflowId: string;
  nodeRef: string;
  title: string;
  description?: string;
  context?: Record<string, unknown>;
  timeoutMs?: number;
  organizationId?: string | null;
}

/**
 * Approval request creation result
 */
export interface CreateApprovalRequestResult {
  approvalId: string;
  approveToken: string;
  rejectToken: string;
  approveUrl: string;
  rejectUrl: string;
}

// Database instance will be injected at runtime
let db: NodePgDatabase<typeof schema> | undefined;
let baseUrl: string = 'http://localhost:3211';

/**
 * Initialize the approval activity with database connection
 */
export function initializeApprovalActivity(options: {
  database: NodePgDatabase<typeof schema>;
  baseUrl?: string;
}) {
  db = options.database;
  if (options.baseUrl) {
    baseUrl = options.baseUrl;
  }
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return `${randomUUID()}-${Date.now().toString(36)}`;
}

/**
 * Activity to create an approval request in the database
 * This is called from the workflow when an approval gate component is executed
 */
export async function createApprovalRequestActivity(
  input: CreateApprovalRequestInput
): Promise<CreateApprovalRequestResult> {
  if (!db) {
    throw new Error('Approval activity not initialized - database connection missing');
  }

  const approvalId = randomUUID();
  const approveToken = generateToken();
  const rejectToken = generateToken();

  // Calculate timeout timestamp if provided
  const timeoutAt = input.timeoutMs 
    ? new Date(Date.now() + input.timeoutMs)
    : null;

  // Insert into database
  await db.insert(schema.approvalRequestsTable).values({
    id: approvalId,
    runId: input.runId,
    workflowId: input.workflowId,
    nodeRef: input.nodeRef,
    status: 'pending',
    title: input.title,
    description: input.description ?? null,
    context: input.context ?? {},
    approveToken,
    rejectToken,
    timeoutAt,
    organizationId: input.organizationId ?? null,
  });

  console.log(`[ApprovalActivity] Created approval request ${approvalId} for run ${input.runId}, node ${input.nodeRef}`);

  // Generate public URLs for approve/reject
  const approveUrl = `${baseUrl}/approve/${approveToken}`;
  const rejectUrl = `${baseUrl}/reject/${rejectToken}`;

  return {
    approvalId,
    approveToken,
    rejectToken,
    approveUrl,
    rejectUrl,
  };
}

/**
 * Activity to cancel a pending approval request
 */
export async function cancelApprovalRequestActivity(
  approvalId: string
): Promise<void> {
  if (!db) {
    console.warn('[ApprovalActivity] Database not initialized, skipping cancellation');
    return;
  }

  await db
    .update(schema.approvalRequestsTable)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(schema.approvalRequestsTable.id, approvalId));

  console.log(`[ApprovalActivity] Cancelled approval request ${approvalId}`);
}
