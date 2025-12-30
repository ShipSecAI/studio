import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ITraceService } from '@shipsec/component-sdk';
import { ConfigurationError } from '@shipsec/component-sdk';
import * as schema from '../../adapters/schema';
import type { HumanInputType } from '../../adapters/schema';

/**
 * Human input request creation input
 */
export interface CreateHumanInputRequestInput {
  runId: string;
  workflowId: string;
  nodeRef: string;
  inputType: HumanInputType;
  inputSchema?: Record<string, unknown>;
  title: string;
  description?: string;
  context?: Record<string, unknown>;
  timeoutMs?: number;
  organizationId?: string | null;
}

/**
 * Human input request creation result
 */
export interface CreateHumanInputRequestResult {
  requestId: string;
  resolveToken: string;
  resolveUrl: string;
}

// Service instances will be injected at runtime
let db: NodePgDatabase<typeof schema> | undefined;
let trace: ITraceService | undefined;
let baseUrl: string = 'http://localhost:3211';

/**
 * Initialize the human input activity with database connection and trace service
 */
export function initializeHumanInputActivity(options: {
  database: NodePgDatabase<typeof schema>;
  trace?: ITraceService;
  baseUrl?: string;
}) {
  db = options.database;
  trace = options.trace;
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
 * Activity to create a human input request in the database
 * This is called from the workflow when a human-input component is executed
 */
export async function createHumanInputRequestActivity(
  input: CreateHumanInputRequestInput
): Promise<CreateHumanInputRequestResult> {
  if (!db) {
    throw new ConfigurationError('Human input activity not initialized - database connection missing', {
      configKey: 'database',
    });
  }

  const requestId = randomUUID();
  const resolveToken = generateToken();

  // Calculate timeout timestamp if provided
  const timeoutAt = input.timeoutMs 
    ? new Date(Date.now() + input.timeoutMs)
    : null;

  // Insert into database
  await db.insert(schema.humanInputRequestsTable).values({
    id: requestId,
    runId: input.runId,
    workflowId: input.workflowId,
    nodeRef: input.nodeRef,
    status: 'pending',
    inputType: input.inputType,
    inputSchema: input.inputSchema ?? {},
    title: input.title,
    description: input.description ?? null,
    context: input.context ?? {},
    resolveToken,
    timeoutAt,
    organizationId: input.organizationId ?? null,
  });

  console.log(`[HumanInputActivity] Created ${input.inputType} request ${requestId} for run ${input.runId}, node ${input.nodeRef}`);

  // Emit AWAITING_INPUT trace event so the UI shows the node as awaiting input
  trace?.record({
    type: 'AWAITING_INPUT',
    runId: input.runId,
    nodeRef: input.nodeRef,
    timestamp: new Date().toISOString(),
    level: 'info',
    data: {
      requestId,
      inputType: input.inputType,
      title: input.title,
      description: input.description,
      timeoutAt: timeoutAt?.toISOString(),
    },
    context: {
      runId: input.runId,
      componentRef: input.nodeRef,
    },
  });

  // Generate public URL for resolving
  const resolveUrl = `${baseUrl}/api/v1/human-inputs/resolve/${resolveToken}`;

  return {
    requestId,
    resolveToken,
    resolveUrl,
  };
}

/**
 * Activity to cancel a pending human input request
 */
export async function cancelHumanInputRequestActivity(
  requestId: string
): Promise<void> {
  if (!db) {
    console.warn('[HumanInputActivity] Database not initialized, skipping cancellation');
    return;
  }

  await db
    .update(schema.humanInputRequestsTable)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(schema.humanInputRequestsTable.id, requestId));

  console.log(`[HumanInputActivity] Cancelled human input request ${requestId}`);
}

/**
 * Activity to expire a pending human input request (due to timeout)
 */
export async function expireHumanInputRequestActivity(
  requestId: string
): Promise<void> {
  if (!db) {
    console.warn('[HumanInputActivity] Database not initialized, skipping expiration');
    return;
  }

  await db
    .update(schema.humanInputRequestsTable)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(eq(schema.humanInputRequestsTable.id, requestId));

  console.log(`[HumanInputActivity] Expired human input request ${requestId}`);
}
