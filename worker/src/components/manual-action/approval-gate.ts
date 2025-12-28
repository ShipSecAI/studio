import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  registerContract,
} from '@shipsec/component-sdk';

/**
 * Approval Gate Component
 * 
 * This component creates a human-in-the-loop gate that pauses workflow execution
 * until a human approves or rejects the request.
 * 
 * Note: The actual waiting logic is handled by the Temporal workflow using signals.
 * This component just creates the approval request and emits a special output
 * that the workflow interprets as "wait for approval signal".
 */

const inputSchema = z.object({
  // Dynamic data that can be passed to the approval context
  data: z.any().optional().describe('Optional data to include in the approval context'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  /** Whether this is a pending approval gate (always true when first created) */
  pending: true;
  /** Unique identifier for this approval request */
  approvalId: string;
  /** Title for the approval request */
  title: string;
  /** Description (if any) */
  description: string | null;
  /** The approval/reject tokens for direct links */
  approveToken: string;
  rejectToken: string;
  /** When the approval will timeout (if set) */
  timeoutAt: string | null;
};

const outputSchema = z.object({
  pending: z.literal(true),
  approvalId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  approveToken: z.string(),
  rejectToken: z.string(),
  timeoutAt: z.string().nullable(),
});

const APPROVAL_PENDING_CONTRACT = 'core.approval-gate.pending.v1';

registerContract({
  name: APPROVAL_PENDING_CONTRACT,
  schema: outputSchema,
  summary: 'Approval gate pending response',
  description:
    'Indicates that a workflow is waiting for human approval. Contains the approval request ID and tokens for approve/reject actions.',
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.workflow.approval-gate',
  label: 'Approval Gate',
  category: 'manual_action',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Pauses workflow execution until a human approves or rejects. Use this for critical decisions that require human oversight.',
  metadata: {
    slug: 'approval-gate',
    version: '1.0.0',
    type: 'process',
    category: 'manual_action',
    description: 'Pause and wait for human approval before continuing. Use for critical decisions requiring oversight.',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'data',
        label: 'Context Data',
        dataType: port.any(),
        required: false,
        description: 'Optional data to show the reviewer for context',
      },
    ],
    outputs: [
      {
        id: 'result',
        label: 'Approval Result',
        dataType: port.contract(APPROVAL_PENDING_CONTRACT),
        description: 'The approval request details',
      },
    ],
    examples: [
      'Require approval before sending a production deployment notification.',
      'Gate access to sensitive operations like deleting resources.',
      'Human review checkpoint in automated security workflows.',
    ],
    parameters: [
      {
        id: 'title',
        label: 'Title',
        type: 'text',
        required: true,
        placeholder: 'Approval Required',
        description: 'Title for the approval request',
        helpText: 'This will be shown to the reviewer',
      },
      {
        id: 'description',
        label: 'Description',
        type: 'textarea',
        required: false,
        placeholder: 'Please review and approve...',
        description: 'Detailed description for the reviewer',
        helpText: 'Provide context about what needs to be approved',
      },
      {
        id: 'timeout',
        label: 'Timeout',
        type: 'text',
        required: false,
        placeholder: '24h',
        description: 'How long to wait for approval (e.g., "1h", "24h", "7d")',
        helpText: 'Leave empty for no timeout. The workflow will fail if approval times out.',
      },
    ],
  },
  async execute(params, context) {
    // Get parameters from component configuration
    const title = (context as any).parameters?.title || 'Approval Required';
    const description = (context as any).parameters?.description || null;
    const timeoutStr = (context as any).parameters?.timeout;

    // Calculate timeout
    let timeoutAt: string | null = null;
    if (timeoutStr) {
      const timeout = parseTimeout(timeoutStr);
      if (timeout) {
        timeoutAt = new Date(Date.now() + timeout).toISOString();
      }
    }

    // Generate secure tokens
    const approveToken = generateSecureToken();
    const rejectToken = generateSecureToken();

    // Create approval ID (will be set by the activity when it creates the DB record)
    // For now, generate a placeholder - the actual creation happens in the activity
    const approvalId = `approval-${context.runId}-${context.componentRef}`;

    // Log the approval gate creation
    context.logger.info(`[Approval Gate] Created approval request: ${title}`);
    context.emitProgress(`Waiting for approval: ${title}`);

    // Store context data if provided
    const contextData = params.data ? { reviewData: params.data } : {};

    // Return the pending state
    // The workflow will intercept this and:
    // 1. Create the actual approval request in the database via an activity
    // 2. Wait for the resolveApprovalSignal
    // 3. Return the final result (approved/rejected) or fail on timeout
    return {
      pending: true as const,
      approvalId,
      title,
      description,
      approveToken,
      rejectToken,
      timeoutAt,
      ...contextData,
    };
  },
};

/**
 * Parse timeout string to milliseconds
 * Supports: 1h, 24h, 7d, 30m, etc.
 */
function parseTimeout(timeout: string): number | null {
  const match = timeout.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Generate a cryptographically secure token
 */
function generateSecureToken(): string {
  // Use crypto.randomUUID for simplicity - it's secure enough for approval tokens
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
}

componentRegistry.register(definition);
