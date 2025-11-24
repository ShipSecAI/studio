import '../../components';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import {
  componentRegistry,
  createExecutionContext,
  runComponentWithRunner,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
} from '@shipsec/component-sdk';
import { TraceAdapter, RedisTerminalStreamAdapter } from '../../adapters';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { ArtifactServiceFactory } from '../artifact-factory';

let globalStorage: IFileStorageService | undefined;
let globalSecrets: ISecretsService | undefined;
let globalArtifacts: ArtifactServiceFactory | undefined;
let globalTrace: ITraceService | undefined;
let globalLogs: WorkflowLogSink | undefined;
let globalTerminal: RedisTerminalStreamAdapter | undefined;

export function initializeComponentActivityServices(options: {
  storage: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: ArtifactServiceFactory;
  trace: ITraceService;
  logs?: WorkflowLogSink;
  terminalStream?: RedisTerminalStreamAdapter;
}) {
  globalStorage = options.storage;
  globalSecrets = options.secrets;
  globalArtifacts = options.artifacts;
  globalTrace = options.trace;
  globalLogs = options.logs;
  globalTerminal = options.terminalStream;
}

export async function setRunMetadataActivity(input: {
  runId: string;
  workflowId: string;
  organizationId?: string | null;
}): Promise<void> {
  if (globalTrace instanceof TraceAdapter) {
    globalTrace.setRunMetadata(input.runId, {
      workflowId: input.workflowId,
      organizationId: input.organizationId ?? null,
    });
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
  const activityInfo = Context.current().info;
  console.log(`🎯 ACTIVITY CALLED - runComponentActivity:`, {
    activityId: activityInfo.activityId,
    attempt: activityInfo.attempt,
    workflowId: activityInfo.workflowExecution?.workflowId ?? 'unknown',
    runId: activityInfo.workflowExecution?.runId ?? 'unknown',
    componentId: action.componentId,
    ref: action.ref,
    timestamp: new Date().toISOString()
  });

  console.log(`📋 Activity input details:`, {
    componentId: action.componentId,
    ref: action.ref,
    hasParams: !!params,
    paramKeys: params ? Object.keys(params) : [],
    warningsCount: warnings.length
  });

  const component = componentRegistry.get(action.componentId);
  if (!component) {
    console.error(`❌ Component not found: ${action.componentId}`);
    throw new Error(`Component not registered: ${action.componentId}`);
  }

  console.log(`✅ Component found: ${action.componentId}`);

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

  const scopedArtifacts = globalArtifacts
    ? globalArtifacts({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId ?? null,
        componentId: action.componentId,
        componentRef: action.ref,
        organizationId: input.organizationId ?? null,
      })
    : undefined;

  const allowSecrets = component.requiresSecrets === true;

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
    secrets: allowSecrets ? globalSecrets : undefined,
    artifacts: scopedArtifacts,
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
              organizationId: input.organizationId ?? null,
            })
            .catch((error) => {
              console.error('[Logs] Failed to append log entry', error);
            });
      }
      : undefined,
    terminalCollector: globalTerminal
      ? (chunk) => {
          void globalTerminal
            ?.append(chunk)
            .catch((error) => {
              console.error('[Terminal] Failed to append chunk', error);
            });
        }
      : undefined,
  });

  try {
    // Execute the component logic directly so that any
    // normalisation/parsing inside `execute` runs.
    // Docker/remote execution should be invoked from within
    // the component via `runComponentWithRunner`.
    const output = await component.execute(parsedParams, context);

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

    const errorType =
      error instanceof Error && error.name ? error.name : 'ComponentError';

    const details = {
      componentId: action.componentId,
      nodeRef: action.ref,
      attempt: activityInfo.attempt,
      activityId: activityInfo.activityId,
      streamId,
      joinStrategy,
      triggeredBy,
      failure,
      stack: error instanceof Error ? error.stack : undefined,
    };

    const isRetryable =
      typeof error === 'object' &&
      error !== null &&
      'retryable' in error &&
      typeof (error as any).retryable === 'boolean'
        ? Boolean((error as any).retryable)
        : false;

    if (isRetryable) {
      throw ApplicationFailure.retryable(errorMsg, errorType, [details]);
    }

    throw ApplicationFailure.nonRetryable(errorMsg, errorType, [details]);
  } finally {
    // Do not finalize run here; lifecycle is managed by workflow orchestration.
  }
}
