import { randomUUID } from 'node:crypto';
import {
  componentRegistry,
  createExecutionContext,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
  type LogEventInput,
} from '@shipsec/component-sdk';
import type {
  WorkflowDefinition,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowLogSink,
} from './types';
import {
  runWorkflowWithScheduler,
  type WorkflowSchedulerRunContext,
  WorkflowSchedulerError,
} from './workflow-scheduler';
import { buildActionParams } from './input-resolver';
import type { ArtifactServiceFactory } from './artifact-factory';

type RegisteredComponent = NonNullable<ReturnType<typeof componentRegistry.get>>;

export interface ExecuteWorkflowOptions {
  runId?: string;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: ArtifactServiceFactory;
  trace?: ITraceService;
  logs?: WorkflowLogSink;
  organizationId?: string | null;
  workflowId?: string;
  workflowVersionId?: string | null;
}

/**
 * Execute a workflow definition using the component registry
 * Services are injected as SDK interfaces (not concrete implementations)
 */
export async function executeWorkflow(
  definition: WorkflowDefinition,
  request: WorkflowRunRequest = {},
  options: ExecuteWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const runId = options.runId ?? randomUUID();
  const results = new Map<string, unknown>();
  const actionsByRef = new Map<string, typeof definition.actions[number]>(
    definition.actions.map((action) => [action.ref, action]),
  );

  const forwardLog: ((entry: LogEventInput) => void) | undefined = options.logs
    ? (entry) => {
        const parsed = new Date(entry.timestamp);
        const timestamp = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        void options.logs
          ?.append({
            runId: entry.runId,
            nodeRef: entry.nodeRef,
            stream: entry.stream,
            level: entry.level,
            message: entry.message,
            timestamp,
          })
          .catch((error) => {
            console.error('[Logs] Failed to append log entry', error);
          });
      }
    : undefined;

  try {
    const runAction = async (
      actionRef: string,
      schedulerContext: WorkflowSchedulerRunContext,
    ): Promise<void> => {
      const action = actionsByRef.get(actionRef);
      if (!action) {
        throw new Error(`Action not found: ${actionRef}`);
      }

      const { triggeredBy, failure } = schedulerContext;

      const component = componentRegistry.get(action.componentId);
      if (!component) {
        throw new Error(`Component not registered: ${action.componentId}`);
      }

      const nodeMetadata = definition.nodes?.[action.ref];
      const streamId = nodeMetadata?.streamId ?? nodeMetadata?.groupId ?? action.ref;
      const joinStrategy = nodeMetadata?.joinStrategy ?? schedulerContext.joinStrategy;

      // Record trace event
      options.trace?.record({
        type: 'NODE_STARTED',
        runId,
        nodeRef: action.ref,
        timestamp: new Date().toISOString(),
        level: 'info',
        context: {
          runId,
          componentRef: action.ref,
          streamId,
          joinStrategy,
          triggeredBy,
          failure,
        },
      });

      const { params, warnings, manualOverrides } = buildActionParams(action, results, {
        componentMetadata: component.metadata,
      });

      for (const override of manualOverrides) {
        options.trace?.record({
          type: 'NODE_PROGRESS',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          level: 'debug',
          message: `Input '${override.target}' using manual value`,
          data: { sourceRef: 'manual' },
          context: {
            runId,
            componentRef: action.ref,
            streamId,
            joinStrategy,
            triggeredBy,
            failure,
          },
        });
      }

      for (const warning of warnings) {
        options.trace?.record({
          type: 'NODE_PROGRESS',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
          level: 'warn',
          data: warning,
          context: {
            runId,
            componentRef: action.ref,
            streamId,
            joinStrategy,
            triggeredBy,
            failure,
          },
        });
      }

      if (warnings.length > 0) {
        const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
        throw new WorkflowSchedulerError(
          `Missing required inputs for ${action.ref}: ${missing}`,
        );
      }

      if (definition.entrypoint.ref === action.ref && request.inputs) {
        // For Manual Trigger, pass runtime inputs in __runtimeData key
        if (action.componentId === 'core.trigger.manual') {
          params.__runtimeData = request.inputs;
        } else {
          // For other components, merge directly
          Object.assign(params, request.inputs);
        }
      }

      const parsedParams = component.inputSchema.parse(params);

      // Create execution context with SDK interfaces
      const scopedArtifacts = options.artifacts
        ? options.artifacts({
            runId,
            workflowId: options.workflowId ?? 'unknown-workflow',
            workflowVersionId: options.workflowVersionId ?? null,
            componentId: action.componentId,
            componentRef: action.ref,
            organizationId: options.organizationId ?? null,
          })
        : undefined;

      const context = createExecutionContext({
        runId,
        componentRef: action.ref,
        metadata: {
          streamId,
          joinStrategy,
          correlationId: `${runId}:${action.ref}`,
          triggeredBy,
          failure,
        },
        storage: options.storage,
        secrets: options.secrets,
        artifacts: scopedArtifacts,
        trace: options.trace,
        logCollector: forwardLog,
      });

      try {
        const rawOutput = await component.execute(parsedParams, context);
        const output = component.outputSchema.parse(rawOutput);
        results.set(action.ref, output);

        options.trace?.record({
          type: 'NODE_COMPLETED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          outputSummary: maskSecretOutputs(component, output),
          level: 'info',
          context: {
            runId,
            componentRef: action.ref,
            streamId,
            joinStrategy,
            triggeredBy,
            failure,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        options.trace?.record({
          type: 'NODE_FAILED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          error: errorMsg,
          level: 'error',
          context: {
            runId,
            componentRef: action.ref,
            streamId,
            joinStrategy,
            triggeredBy,
            failure,
          },
        });
        throw error;
      }
    };

    await runWorkflowWithScheduler(definition, {
      run: runAction,
    });

    const outputsObject: Record<string, unknown> = {};
    let reportedFailure = false;
    const failureDetails: string[] = [];

    results.forEach((value, key) => {
      outputsObject[key] = value;
      if (isComponentFailure(value)) {
        reportedFailure = true;
        const message = extractFailureMessage(value);
        failureDetails.push(`[${key}] ${message}`);
      }
    });

    if (reportedFailure) {
      const baseMessage = 'One or more workflow actions failed';
      return {
        outputs: outputsObject,
        success: false,
        error:
          failureDetails.length > 0
            ? `${baseMessage}: ${failureDetails.join('; ')}`
            : baseMessage,
      };
    }

    return { outputs: outputsObject, success: true };
  } catch (error) {
    return {
      outputs: {},
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isComponentFailure(value: unknown): value is { success: boolean; error?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success?: unknown }).success === false
  );
}

function extractFailureMessage(value: { success: boolean; error?: unknown }): string {
  if (!value) {
    return 'Component reported failure';
  }
  const errorMessage = value.error;
  if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
    return errorMessage;
  }
  return 'Component reported failure';
}

function maskSecretOutputs(component: RegisteredComponent, output: unknown): unknown {
  const secretPorts =
    component.metadata?.outputs?.filter((port) =>
      port.dataType?.kind === 'primitive' && port.dataType.name === 'secret',
    ) ?? [];
  if (secretPorts.length === 0) {
    return output;
  }

  if (secretPorts.some((port) => port.id === '__self__')) {
    return '***';
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const clone = { ...(output as Record<string, unknown>) };
    for (const port of secretPorts) {
      if (Object.prototype.hasOwnProperty.call(clone, port.id)) {
        clone[port.id] = '***';
      }
    }
    return clone;
  }

  return '***';
}
