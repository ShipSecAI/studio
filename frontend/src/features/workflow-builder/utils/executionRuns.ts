import { TERMINAL_STATUSES, type ExecutionInputPreview } from '@shipsec/shared';
import type { ExecutionStatus } from '@/schemas/execution';
import type { ExecutionRun } from '@/hooks/queries/useRunQueries';
import type { components } from '../../../../../packages/backend-client/src/client';

/** @deprecated Use TERMINAL_STATUSES from @shipsec/shared instead */
export const TERMINAL_RUN_STATUSES = TERMINAL_STATUSES;

type ApiRunItem = components['schemas']['RunListResponseDto']['runs'][number];
type ApiRunDetail = components['schemas']['RunDetailDto'];
type RawRun = ApiRunItem | ApiRunDetail;

export const normalizeRunSummary = (run: RawRun): ExecutionRun => {
  const status = run.status as ExecutionStatus;
  const startTime = run.startTime;
  const endTime = run.endTime ?? undefined;

  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status,
    startTime,
    endTime,
    duration: typeof run.duration === 'number' ? run.duration : undefined,
    nodeCount: run.nodeCount,
    eventCount: run.eventCount,
    createdAt: startTime,
    isLive: !TERMINAL_RUN_STATUSES.includes(status),
    workflowVersionId: run.workflowVersionId,
    workflowVersion: run.workflowVersion,
    triggerType: run.triggerType ?? 'manual',
    triggerSource: run.triggerSource,
    triggerLabel: run.triggerLabel,
    inputPreview: (run.inputPreview as ExecutionInputPreview) ?? {
      runtimeInputs: {},
      nodeOverrides: {},
    },
  };
};

export const isRunLive = (run?: ExecutionRun | null) => {
  if (!run) {
    return false;
  }
  if (run.isLive) {
    return true;
  }
  return !TERMINAL_RUN_STATUSES.includes(run.status);
};
