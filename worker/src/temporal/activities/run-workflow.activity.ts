import '../../components'; // Register all components
import { executeWorkflow } from '../workflow-runner';
import type {
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { IFileStorageService, ITraceService } from '@shipsec/component-sdk';
import { TraceAdapter } from '../../adapters';

// Global service container (set by worker initialization)
let globalStorage: IFileStorageService | undefined;
let globalTrace: ITraceService | undefined;
let globalLogs: WorkflowLogSink | undefined;

export function initializeActivityServices(
  storage: IFileStorageService,
  trace: ITraceService,
  logs?: WorkflowLogSink,
) {
  globalStorage = storage;
  globalTrace = trace;
  globalLogs = logs;
}

export async function runWorkflowActivity(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  console.log(`🔧 [ACTIVITY] runWorkflow started for run: ${input.runId}`);
  console.log(`🔧 [ACTIVITY] Workflow: ${input.workflowId}, Actions: ${input.definition.actions.length}`);

  try {
    if (globalTrace instanceof TraceAdapter) {
      globalTrace.setRunMetadata(input.runId, { workflowId: input.workflowId });
    }

    const result = await executeWorkflow(
      input.definition,
      {
        inputs: input.inputs,
      },
      {
        runId: input.runId,
        storage: globalStorage,
        trace: globalTrace,
        logs: globalLogs,
      },
    );

    console.log(`✅ [ACTIVITY] runWorkflow completed for run: ${input.runId}`);
    return result;
  } catch (error) {
    console.error(`❌ [ACTIVITY] runWorkflow failed for run: ${input.runId}`, error);
    throw error;
  } finally {
    if (globalTrace instanceof TraceAdapter) {
      globalTrace.finalizeRun(input.runId);
    }
  }
}
