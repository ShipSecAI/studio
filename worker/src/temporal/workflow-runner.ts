import { randomUUID } from 'node:crypto';
import {
  componentRegistry,
  createExecutionContext,
  type IFileStorageService,
  type ISecretsService,
  type IArtifactService,
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

export interface ExecuteWorkflowOptions {
  runId?: string;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: IArtifactService;
  trace?: ITraceService;
  logs?: WorkflowLogSink;
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

      const { params, warnings } = buildActionParams(action, results);

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
        artifacts: options.artifacts,
        trace: options.trace,
        logCollector: forwardLog,
      });

      try {
        const output = await component.execute(parsedParams, context);
        results.set(action.ref, output);

        options.trace?.record({
          type: 'NODE_COMPLETED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          outputSummary: output,
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
    results.forEach((value, key) => {
      outputsObject[key] = value;
    });

    return { outputs: outputsObject, success: true };
  } catch (error) {
    return {
      outputs: {},
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
