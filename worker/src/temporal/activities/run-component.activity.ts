import '../../components';
import { Context } from '@temporalio/activity';
import {
  componentRegistry,
  createExecutionContext,
  runComponentWithRunner,
  type IArtifactService,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
} from '@shipsec/component-sdk';
import { TraceAdapter } from '../../adapters';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowLogSink,
} from '../types';

let globalStorage: IFileStorageService | undefined;
let globalSecrets: ISecretsService | undefined;
let globalArtifacts: IArtifactService | undefined;
let globalTrace: ITraceService | undefined;
let globalLogs: WorkflowLogSink | undefined;

export function initializeComponentActivityServices(options: {
  storage: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace: ITraceService;
  logs?: WorkflowLogSink;
}) {
  globalStorage = options.storage;
  globalSecrets = options.secrets;
  globalArtifacts = options.artifacts;
  globalTrace = options.trace;
  globalLogs = options.logs;
}

export async function setRunMetadataActivity(input: { runId: string; workflowId: string }): Promise<void> {
  if (globalTrace instanceof TraceAdapter) {
    globalTrace.setRunMetadata(input.runId, { workflowId: input.workflowId });
  }
}

export async function finalizeRunActivity(input: { runId: string }): Promise<void> {
  if (globalTrace instanceof TraceAdapter) {
    globalTrace.finalizeRun(input.runId);
  }
}

export async function runComponentActivity(
  input: RunComponentActivityInput,
): Promise<RunComponentActivityOutput> {
  const { action, params, warnings = [] } = input;
  const component = componentRegistry.get(action.componentId);
  if (!component) {
    throw new Error(`Component not registered: ${action.componentId}`);
  }

  const activityInfo = Context.current().info;
  const nodeMetadata = input.metadata ?? {};
  const streamId = nodeMetadata.streamId ?? nodeMetadata.groupId ?? action.ref;
  const joinStrategy = nodeMetadata.joinStrategy;
  const triggeredBy = nodeMetadata.triggeredBy;
  const failure = nodeMetadata.failure;
  const correlationId = `${input.runId}:${action.ref}:${activityInfo.activityId}`;

  const trace = globalTrace;
  trace?.record({
    type: 'NODE_STARTED',
    runId: input.runId,
    nodeRef: action.ref,
    timestamp: new Date().toISOString(),
    level: 'info',
    context: {
      runId: input.runId,
      componentRef: action.ref,
      activityId: activityInfo.activityId,
      attempt: activityInfo.attempt,
      correlationId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
    },
  });

  for (const warning of warnings) {
    trace?.record({
      type: 'NODE_PROGRESS',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
      level: 'warn',
      data: warning,
      context: {
        runId: input.runId,
        componentRef: action.ref,
        activityId: activityInfo.activityId,
        attempt: activityInfo.attempt,
        correlationId,
        streamId,
        joinStrategy,
        triggeredBy,
        failure,
      },
    });
  }

  if (warnings.length > 0) {
    const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
    throw new Error(`Missing required inputs for ${action.ref}: ${missing}`);
  }

  const parsedParams = component.inputSchema.parse(params);

  const context = createExecutionContext({
    runId: input.runId,
    componentRef: action.ref,
    metadata: {
      activityId: activityInfo.activityId,
      attempt: activityInfo.attempt,
      correlationId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
    },
    storage: globalStorage,
    secrets: globalSecrets,
    artifacts: globalArtifacts,
    trace: globalTrace,
    logCollector: globalLogs
      ? (entry) => {
          void globalLogs
            ?.append({
              runId: entry.runId,
              nodeRef: entry.nodeRef,
              stream: entry.stream,
              level: entry.level,
              message: entry.message,
              timestamp: new Date(entry.timestamp),
              metadata: entry.metadata,
            })
            .catch((error) => {
              console.error('[Logs] Failed to append log entry', error);
            });
      }
      : undefined,
  });

  try {
    const output = await runComponentWithRunner(
      component.runner,
      component.execute,
      parsedParams,
      context,
    );

    trace?.record({
      type: 'NODE_COMPLETED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      outputSummary: output,
      level: 'info',
      context: {
        runId: input.runId,
        componentRef: action.ref,
        activityId: activityInfo.activityId,
        attempt: activityInfo.attempt,
      correlationId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
    },
  });

    return { output };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    trace?.record({
      type: 'NODE_FAILED',
      runId: input.runId,
      nodeRef: action.ref,
      timestamp: new Date().toISOString(),
      error: errorMsg,
      level: 'error',
      context: {
        runId: input.runId,
        componentRef: action.ref,
        activityId: activityInfo.activityId,
        attempt: activityInfo.attempt,
      correlationId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
    },
  });
    throw error;
  } finally {
    // Do not finalize run here; lifecycle is managed by workflow orchestration.
  }
}
