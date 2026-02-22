import { ExecutionStatus } from '@shipsec/shared';

type JsonRecord = Record<string, unknown>;

export interface ParsedWorkflowRunOutput {
  runId?: string;
  workflowId?: string;
  status?: ExecutionStatus;
  taskId?: string;
  statusMessage?: string;
}

const EXECUTION_STATUS_SET = new Set<ExecutionStatus>([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TERMINATED',
  'TIMED_OUT',
  'AWAITING_INPUT',
  'STALE',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function toExecutionStatus(value: unknown): ExecutionStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return EXECUTION_STATUS_SET.has(value as ExecutionStatus)
    ? (value as ExecutionStatus)
    : undefined;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;

  if (typeof value === 'string') {
    const parsed = parseJsonString(value);
    return parsed === value ? value : extractPayload(parsed, depth + 1);
  }

  if (!isRecord(value)) {
    return value;
  }

  if (Array.isArray(value.content)) {
    const text = value.content
      .filter(
        (part): part is { type: string; text: string } =>
          isRecord(part) && part.type === 'text' && typeof part.text === 'string',
      )
      .map((part) => part.text)
      .join('\n');

    if (text) {
      return extractPayload(text, depth + 1);
    }
  }

  return value;
}

function mapTaskStatusToExecutionStatus(
  status: unknown,
  statusMessage: unknown,
): ExecutionStatus | undefined {
  const fromMessage = toExecutionStatus(statusMessage);
  if (fromMessage) return fromMessage;

  if (status === 'completed') return 'COMPLETED';
  if (status === 'failed') return 'FAILED';
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'working') return 'RUNNING';

  return undefined;
}

export function parseWorkflowRunOutput(output: unknown): ParsedWorkflowRunOutput | null {
  const payload = extractPayload(output);
  if (!isRecord(payload)) return null;

  if (payload.source === 'mcp-task') {
    let innerRunId: string | undefined = undefined;
    let innerWorkflowId: string | undefined = undefined;

    // Try to get runId/workflowId from the final result
    if (payload.result !== undefined) {
      const innerPayload = extractPayload(payload.result);
      if (isRecord(innerPayload)) {
        if (typeof innerPayload.runId === 'string') innerRunId = innerPayload.runId;
        if (typeof innerPayload.workflowId === 'string') innerWorkflowId = innerPayload.workflowId;
      }
    }

    // Also parse from statusMessage JSON (sent during live polling before final result)
    if (typeof payload.statusMessage === 'string') {
      try {
        const parsed = JSON.parse(payload.statusMessage) as Record<string, unknown>;
        if (!innerRunId && typeof parsed.runId === 'string') innerRunId = parsed.runId;
        if (!innerWorkflowId && typeof parsed.workflowId === 'string')
          innerWorkflowId = parsed.workflowId;
      } catch {
        // statusMessage is plain text, not JSON — ignore
      }
    }

    return {
      taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
      status: mapTaskStatusToExecutionStatus(payload.status, payload.statusMessage),
      statusMessage: typeof payload.statusMessage === 'string' ? payload.statusMessage : undefined,
      runId: innerRunId,
      workflowId: innerWorkflowId,
    };
  }

  const status = toExecutionStatus(payload.status);
  const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
  const workflowId = typeof payload.workflowId === 'string' ? payload.workflowId : undefined;

  if (!runId && !workflowId && !status) {
    return null;
  }

  return {
    runId,
    workflowId,
    status,
  };
}
