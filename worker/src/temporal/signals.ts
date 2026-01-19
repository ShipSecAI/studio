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
