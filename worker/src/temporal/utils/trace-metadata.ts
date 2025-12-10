import type { ITraceService } from '@shipsec/component-sdk';

export interface TraceMetadataAware extends ITraceService {
  setRunMetadata(
    runId: string,
    metadata: { workflowId?: string; organizationId?: string | null },
  ): void;
  finalizeRun?(runId: string): void;
}

export function isTraceMetadataAware(trace: ITraceService | undefined): trace is TraceMetadataAware {
  return Boolean(trace && typeof (trace as any).setRunMetadata === 'function');
}
