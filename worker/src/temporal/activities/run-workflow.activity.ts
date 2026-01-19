import '../../components'; // Register all components
import { executeWorkflow } from '../workflow-runner';
import type {
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { IFileStorageService, ITraceService, ISecretsService } from '@shipsec/component-sdk';
import type { ArtifactServiceFactory } from '../artifact-factory';
import { isTraceMetadataAware } from '../utils/trace-metadata';

// Global service container (set by worker initialization)
let globalStorage: IFileStorageService | undefined;
let globalTrace: ITraceService | undefined;
let globalLogs: WorkflowLogSink | undefined;
let globalSecrets: ISecretsService | undefined;
let globalArtifacts: ArtifactServiceFactory | undefined;

export function initializeActivityServices(
  storage: IFileStorageService,
  trace: ITraceService,
  logs?: WorkflowLogSink,
  secrets?: ISecretsService,
  artifacts?: ArtifactServiceFactory,
) {
  globalStorage = storage;
  globalTrace = trace;
  globalLogs = logs;
  globalSecrets = secrets;
  globalArtifacts = artifacts;
}

export async function runWorkflowActivity(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  console.log(`╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`🔧 [ACTIVITY START] runWorkflowActivity called`);
  console.log(`📋 Run ID: ${input.runId}`);
  console.log(`📋 Workflow ID: ${input.workflowId}`);
  console.log(`📋 Actions count: ${input.definition.actions.length}`);
  console.log(`📋 Action refs: ${input.definition.actions.map((a) => a.ref).join(', ')}`);
  console.log(`📋 Inputs keys: ${Object.keys(input.inputs || {}).join(', ')}`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
  const startTime = Date.now();

  try {
    if (isTraceMetadataAware(globalTrace)) {
      globalTrace.setRunMetadata(input.runId, {
        workflowId: input.workflowId,
        organizationId: input.organizationId ?? null,
      });
    }

    console.log(`⏳ [ACTIVITY] About to call executeWorkflow for ${input.runId}`);
    const result = await executeWorkflow(
      input.definition,
      {
        inputs: input.inputs,
        organizationId: input.organizationId ?? null,
      },
      {
        runId: input.runId,
        storage: globalStorage,
        secrets: globalSecrets,
        trace: globalTrace,
        logs: globalLogs,
        organizationId: input.organizationId ?? null,
        artifacts: globalArtifacts,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId ?? null,
      },
    );
    const duration = Date.now() - startTime;
    console.log(
      `✅ [ACTIVITY DONE] runWorkflow completed for run: ${input.runId} in ${duration}ms`,
    );
    console.log(`📊 [ACTIVITY] Result keys: ${Object.keys(result || {}).join(', ')}`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `❌ [ACTIVITY FAIL] runWorkflow FAILED for run: ${input.runId} after ${duration}ms`,
    );
    console.error(`❌ [ACTIVITY] Error type: ${error?.constructor?.name}`);
    console.error(
      `❌ [ACTIVITY] Error message: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `❌ [ACTIVITY] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`,
    );
    throw error;
  } finally {
    if (isTraceMetadataAware(globalTrace) && typeof globalTrace.finalizeRun === 'function') {
      console.log(`🧹 [ACTIVITY] Finalizing trace metadata for ${input.runId}`);
      globalTrace.finalizeRun(input.runId);
    }
  }
}
