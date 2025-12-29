import '../../components';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import {
  componentRegistry,
  createExecutionContext,
  runComponentWithRunner,
  NotFoundError,
  ValidationError,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
  type AgentTracePublisher,
} from '@shipsec/component-sdk';
import { RedisTerminalStreamAdapter } from '../../adapters';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  WorkflowLogSink,
} from '../types';
import type { ArtifactServiceFactory } from '../artifact-factory';
import { isTraceMetadataAware } from '../utils/trace-metadata';

let globalStorage: IFileStorageService | undefined;
let globalSecrets: ISecretsService | undefined;
let globalArtifacts: ArtifactServiceFactory | undefined;
let globalTrace: ITraceService | undefined;
let globalLogs: WorkflowLogSink | undefined;
let globalTerminal: RedisTerminalStreamAdapter | undefined;
let globalAgentTracePublisher: AgentTracePublisher | undefined;

export function initializeComponentActivityServices(options: {
  storage: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: ArtifactServiceFactory;
  trace: ITraceService;
  logs?: WorkflowLogSink;
  terminalStream?: RedisTerminalStreamAdapter;
  agentTracePublisher?: AgentTracePublisher;
}) {
  globalStorage = options.storage;
  globalSecrets = options.secrets;
  globalArtifacts = options.artifacts;
  globalTrace = options.trace;
  globalLogs = options.logs;
  globalTerminal = options.terminalStream;
  globalAgentTracePublisher = options.agentTracePublisher;
}

export async function setRunMetadataActivity(input: {
  runId: string;
  workflowId: string;
  organizationId?: string | null;
}): Promise<void> {
  if (isTraceMetadataAware(globalTrace)) {
    globalTrace.setRunMetadata(input.runId, {
      workflowId: input.workflowId,
      organizationId: input.organizationId ?? null,
    });
  }
}

export async function finalizeRunActivity(input: { runId: string }): Promise<void> {
  if (isTraceMetadataAware(globalTrace) && typeof globalTrace.finalizeRun === 'function') {
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
    throw new NotFoundError(`Component not registered: ${action.componentId}`, {
      resourceType: 'component',
      resourceId: action.componentId,
      details: { actionRef: action.ref },
    });
  }

  console.log(`✅ Component found: ${action.componentId}`);

  const nodeMetadata = input.metadata ?? {};
  const streamId = nodeMetadata.streamId ?? nodeMetadata.groupId ?? action.ref;
  const joinStrategy = nodeMetadata.joinStrategy;
  const triggeredBy = nodeMetadata.triggeredBy;
  const failure = nodeMetadata.failure;
  const correlationId = `${input.runId}:${action.ref}:${activityInfo.activityId}`;

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
    agentTracePublisher: globalAgentTracePublisher,
  });

  context.trace?.record({
    type: 'NODE_STARTED',
    timestamp: new Date().toISOString(),
    level: 'info',
  });

  for (const warning of warnings) {
    context.trace?.record({
      type: 'NODE_PROGRESS',
      timestamp: new Date().toISOString(),
      message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
      level: 'warn',
      data: warning,
    });
  }

  if (warnings.length > 0) {
    const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
    throw new ValidationError(`Missing required inputs for ${action.ref}: ${missing}`, {
      fieldErrors: Object.fromEntries(
        warnings.map((w) => [w.target, [`mapped from ${w.sourceRef}.${w.sourceHandle} was undefined`]])
      ),
      details: { actionRef: action.ref, componentId: action.componentId },
    });
  }

  const parsedParams = component.inputSchema.parse(params);

  try {
    // Execute the component logic directly so that any
    // normalisation/parsing inside `execute` runs.
    // Docker/remote execution should be invoked from within
    // the component via `runComponentWithRunner`.
    const output = await component.execute(parsedParams, context);

    // Check if component requested suspension (e.g. approval gate)
    const isSuspended = output && typeof output === 'object' && 'pending' in output && (output as any).pending === true;

    // Extract activeOutputPorts if component returned them (for conditional execution)
    const activeOutputPorts = output && typeof output === 'object' && 'activeOutputPorts' in output
      ? (output as any).activeOutputPorts as string[]
      : undefined;

    if (!isSuspended) {
      context.trace?.record({
        type: 'NODE_COMPLETED',
        timestamp: new Date().toISOString(),
        outputSummary: output as any,
        data: activeOutputPorts ? { activatedPorts: activeOutputPorts } : undefined,
        level: 'info',
      });
    }

    return { output, activeOutputPorts };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Extract error properties without using 'any'
    let errorType: string | undefined;
    let errorDetails: Record<string, unknown> | undefined;
    let fieldErrors: Record<string, string[]> | undefined;
    let isRetryable = false;

    if (error instanceof Error) {
      errorType = error.name;
      
      // Check if it's a ComponentError (has type and retryable properties)
      if ('type' in error && typeof (error as { type: unknown }).type === 'string') {
        errorType = (error as { type: string }).type;
      }
      
      // Check if it's retryable
      if ('retryable' in error && typeof (error as { retryable: unknown }).retryable === 'boolean') {
        isRetryable = (error as { retryable: boolean }).retryable;
      }
      
      // Extract details if present
      if ('details' in error && typeof (error as { details: unknown }).details === 'object' && (error as { details: unknown }).details !== null) {
        errorDetails = (error as { details: Record<string, unknown> }).details;
      }
      
      // Extract fieldErrors if it's a ValidationError
      if (error instanceof ValidationError && error.fieldErrors) {
        fieldErrors = error.fieldErrors;
      }
    }

    const traceError: {
      message: string;
      type?: string;
      stack?: string;
      details?: Record<string, unknown>;
      fieldErrors?: Record<string, string[]>;
    } = {
      message: errorMsg,
      type: errorType || 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined,
      details: errorDetails,
      fieldErrors,
    };
    
    context.trace?.record({
      type: 'NODE_FAILED',
      timestamp: new Date().toISOString(),
      message: errorMsg,
      error: traceError,
      level: 'error',
    });

    const finalErrorType = errorType || 'ComponentError';

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

    if (isRetryable) {
      throw ApplicationFailure.retryable(errorMsg, finalErrorType, [details]);
    }

    throw ApplicationFailure.nonRetryable(errorMsg, finalErrorType, [details]);
  } finally {
    // Do not finalize run here; lifecycle is managed by workflow orchestration.
  }
}
