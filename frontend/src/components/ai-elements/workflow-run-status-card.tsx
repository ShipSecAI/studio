import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useExecutionStatus } from '@/hooks/queries/useExecutionQueries';
import { TERMINAL_STATUSES, type ExecutionStatus } from '@shipsec/shared';
import { CheckCircle2, Clock3, Loader2, OctagonX, PlayCircle, XCircle } from 'lucide-react';

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
    return {
      taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
      status: mapTaskStatusToExecutionStatus(payload.status, payload.statusMessage),
      statusMessage: typeof payload.statusMessage === 'string' ? payload.statusMessage : undefined,
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

function statusPresentation(status: ExecutionStatus | undefined) {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Completed', badge: 'success' as const, icon: CheckCircle2 };
    case 'FAILED':
      return { label: 'Failed', badge: 'destructive' as const, icon: XCircle };
    case 'CANCELLED':
    case 'TERMINATED':
    case 'TIMED_OUT':
      return { label: status, badge: 'warning' as const, icon: OctagonX };
    case 'QUEUED':
      return { label: 'Queued', badge: 'secondary' as const, icon: Clock3 };
    case 'AWAITING_INPUT':
      return { label: 'Awaiting input', badge: 'warning' as const, icon: Clock3 };
    case 'RUNNING':
      return { label: 'Running', badge: 'secondary' as const, icon: Loader2 };
    default:
      return { label: 'Running', badge: 'secondary' as const, icon: PlayCircle };
  }
}

export function WorkflowRunStatusCard({ run }: { run: ParsedWorkflowRunOutput }) {
  const { data: statusData, error } = useExecutionStatus(run.runId ?? null);

  const effectiveStatus = statusData?.status ?? run.status ?? 'RUNNING';
  const effectiveRunId = statusData?.runId ?? run.runId;
  const effectiveWorkflowId = statusData?.workflowId ?? run.workflowId;
  const terminal = TERMINAL_STATUSES.includes(effectiveStatus);
  const statusMeta = statusPresentation(effectiveStatus);
  const StatusIcon = statusMeta.icon;

  return (
    <Card className="border-primary/20 bg-muted/30">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`h-4 w-4 ${effectiveStatus === 'RUNNING' ? 'animate-spin' : ''}`}
            />
            <span className="font-medium text-sm">Workflow Run</span>
          </div>
          <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
        </div>

        <div className="space-y-1 text-xs">
          {effectiveRunId ? (
            <div className="text-muted-foreground">
              Run ID: <span className="font-mono text-foreground">{effectiveRunId}</span>
            </div>
          ) : run.taskId ? (
            <div className="text-muted-foreground">
              Task ID: <span className="font-mono text-foreground">{run.taskId}</span>
            </div>
          ) : null}

          {statusData?.progress && (
            <div className="text-muted-foreground">
              Progress: {statusData.progress.completedActions}/{statusData.progress.totalActions}
            </div>
          )}

          {effectiveWorkflowId && effectiveRunId && (
            <a
              className="inline-flex text-primary underline-offset-2 hover:underline"
              href={`/workflows/${effectiveWorkflowId}/runs/${effectiveRunId}`}
            >
              Open run details
            </a>
          )}

          {!terminal && error && (
            <div className="text-amber-600">
              Live status check unavailable. Using cached status.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
