import { randomUUID } from 'node:crypto';
import {
  componentRegistry,
  createExecutionContext,
  runComponentWithRunner,
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
    for (const action of definition.actions) {
      const component = componentRegistry.get(action.componentId);
      if (!component) {
        throw new Error(`Component not registered: ${action.componentId}`);
      }

      // Record trace event
      options.trace?.record({
        type: 'NODE_STARTED',
        runId,
        nodeRef: action.ref,
        timestamp: new Date().toISOString(),
        level: 'info',
      });

      // Merge params with inputs for entrypoint
      const params = { ...action.params } as Record<string, unknown>;
      for (const [targetKey, mapping] of Object.entries(action.inputMappings ?? {})) {
        const sourceOutput = results.get(mapping.sourceRef);
        const resolved = resolveInputValue(sourceOutput, mapping.sourceHandle);

        if (resolved !== undefined) {
          params[targetKey] = resolved;
        } else {
          options.trace?.record({
            type: 'NODE_PROGRESS',
            runId,
            nodeRef: action.ref,
            timestamp: new Date().toISOString(),
            message: `Input '${targetKey}' mapped from ${mapping.sourceRef}.${mapping.sourceHandle} was undefined`,
            level: 'warn',
            data: {
              target: targetKey,
              sourceRef: mapping.sourceRef,
              sourceHandle: mapping.sourceHandle,
            },
          });
        }
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
        storage: options.storage,
        secrets: options.secrets,
        artifacts: options.artifacts,
        trace: options.trace,
        logCollector: forwardLog,
      });

      try {
        const output = await runComponentWithRunner(
          component.runner,
          component.execute,
          parsedParams,
          context,
        );
        results.set(action.ref, output);

        options.trace?.record({
          type: 'NODE_COMPLETED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          outputSummary: output,
          level: 'info',
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
        });
        throw error;
      }
    }

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

function resolveInputValue(sourceOutput: unknown, sourceHandle: string): unknown {
  if (sourceOutput === null || sourceOutput === undefined) {
    return undefined;
  }

  if (sourceHandle === '__self__') {
    return sourceOutput;
  }

  if (typeof sourceOutput === 'object') {
    const record = sourceOutput as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, sourceHandle)) {
      return record[sourceHandle];
    }
  }

  return undefined;
}
