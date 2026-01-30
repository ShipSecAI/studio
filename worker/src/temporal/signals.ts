import { defineSignal } from '@temporalio/workflow';

/**
 * Signal for resolving a human input gate
 */
export interface HumanInputResolution {
  /** The human input request ID */
  requestId: string;
  /** The node reference that was waiting */
  nodeRef: string;
  /** Whether the input was approved/accepted */
  approved: boolean;
  /** Who responded to the request */
  respondedBy?: string;
  /** Optional note from the reviewer */
  responseNote?: string;
  /** When the response was received */
  respondedAt: string;
  /** Additional response data */
  responseData?: Record<string, unknown>;
}

/**
 * Signal to resolve a pending human input gate
 */
export const resolveHumanInputSignal = defineSignal<[HumanInputResolution]>('resolveHumanInput');

/**
 * Query to get pending human inputs for a workflow run
 */
export interface PendingHumanInput {
  requestId: string;
  nodeRef: string;
  title: string;
  createdAt: string;
}

// =============================================================================
// Tool Call Signals (for MCP Gateway)
// =============================================================================

/**
 * Request to execute a tool within the workflow context
 */
export interface ToolCallRequest {
  /** Unique identifier for this tool call */
  callId: string;
  /** The node ID of the registered tool */
  nodeId: string;
  /** The component ID to execute */
  componentId: string;
  /** Arguments provided by the agent */
  arguments: Record<string, unknown>;
  /** Pre-bound credentials from tool registration */
  credentials?: Record<string, unknown>;
  /** Component parameters */
  parameters?: Record<string, unknown>;
  /** Timestamp when the call was initiated */
  requestedAt: string;
}

/**
 * Result of a tool call execution
 */
export interface ToolCallResult {
  /** The call ID this result corresponds to */
  callId: string;
  /** Whether the execution was successful */
  success: boolean;
  /** The output from the component (if successful) */
  output?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Timestamp when the call completed */
  completedAt: string;
}

/**
 * Signal to request tool execution within the workflow
 */
export const executeToolCallSignal = defineSignal<[ToolCallRequest]>('executeToolCall');

/**
 * Signal sent back when a tool call completes (for external listeners)
 * Note: This is informational - results are also stored in workflow state
 */
export const toolCallCompletedSignal = defineSignal<[ToolCallResult]>('toolCallCompleted');

// =============================================================================
// Queries (for polling tool call results)
// =============================================================================

/**
 * Query to get of a specific tool call result
 */
export const getToolCallResultQuery = 'getToolCallResult';
