import { randomUUID } from 'node:crypto';
import {
  componentRegistry,
  createExecutionContext,
  NotFoundError,
  ValidationError,
  isSpilledDataMarker,
  TEMPORAL_SPILL_THRESHOLD_BYTES,
  type IFileStorageService,
  type ISecretsService,
  type ITraceService,
  type INodeIOService,
  type ComponentPortMetadata,
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
import { createLightweightSummary } from './utils/component-output';
import { buildActionPayload } from './input-resolver';
import type { ArtifactServiceFactory } from './artifact-factory';

export interface ExecuteWorkflowOptions {
  runId?: string;
  storage?: IFileStorageService;
  secrets?: ISecretsService;
  artifacts?: ArtifactServiceFactory;
  trace?: ITraceService;
  nodeIO?: INodeIOService;
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
  console.log(`🏃 [WORKFLOW RUNNER] executeWorkflow called for runId: ${runId}`);
  console.log(`📋 [WORKFLOW RUNNER] Definition has ${definition.actions.length} actions`);
  console.log(`📋 [WORKFLOW RUNNER] Entrypoint ref: ${definition.entrypoint.ref}`);

  const results = new Map<string, unknown>();
  const actionsByRef = new Map<string, (typeof definition.actions)[number]>(
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
    ): Promise<{ activePorts?: string[] | undefined } | null> => {
      console.log(
        `🎯 [WORKFLOW RUNNER] runAction called for: ${actionRef} (triggered by: ${schedulerContext.triggeredBy || 'root'})`,
      );

      const action = actionsByRef.get(actionRef);
      if (!action) {
        throw new NotFoundError(`Action not found: ${actionRef}`, {
          resourceType: 'action',
          resourceId: actionRef,
          details: { runId },
        });
      }

      const { triggeredBy, failure } = schedulerContext;

      const entry = componentRegistry.getMetadata(action.componentId);
      if (!entry) {
        throw new NotFoundError(`Component not registered: ${action.componentId}`, {
          resourceType: 'component',
          resourceId: action.componentId,
          details: { actionRef, runId },
        });
      }
      const component = entry.definition;
      const inputPorts = entry.inputs ?? [];
      const outputPorts = entry.outputs ?? [];

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

      const { inputs, params, warnings, manualOverrides } = buildActionPayload(action, results, {
        componentMetadata: { inputs: inputPorts },
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

      // Resolve spilled inputs if necessary
      const resolvedParams = { ...params };
      const spilledObjectsCache = new Map<string, any>();

      for (const [key, value] of Object.entries(resolvedParams)) {
        if (isSpilledDataMarker(value)) {
          if (!options.storage) {
            console.warn(
              `[WorkflowRunner] Parameter '${key}' is spilled but no storage service is available`,
            );
            continue;
          }

          try {
            let fullData: any;
            if (spilledObjectsCache.has(value.storageRef)) {
              fullData = spilledObjectsCache.get(value.storageRef);
            } else {
              const content = await options.storage.downloadFile(value.storageRef);
              fullData = JSON.parse(content.buffer.toString('utf8'));
              spilledObjectsCache.set(value.storageRef, fullData);
            }

            const handle = (value as any).__spilled_handle__;
            if (handle && handle !== '__self__') {
              if (
                fullData &&
                typeof fullData === 'object' &&
                Object.prototype.hasOwnProperty.call(fullData, handle)
              ) {
                resolvedParams[key] = fullData[handle];
              } else {
                console.warn(
                  `[WorkflowRunner] Spilled handle '${handle}' not found in downloaded data for parameter '${key}'`,
                );
                resolvedParams[key] = undefined;
                warnings.push({
                  target: key,
                  sourceRef: 'spilled-storage',
                  sourceHandle: handle,
                });
              }
            } else {
              resolvedParams[key] = fullData;
            }
          } catch (err) {
            console.error(`[WorkflowRunner] Failed to resolve spilled parameter '${key}':`, err);
            throw new WorkflowSchedulerError(
              `Failed to resolve spilled input parameter '${key}': ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      if (warnings.length > 0) {
        const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
        throw new WorkflowSchedulerError(`Missing required inputs for ${action.ref}: ${missing}`);
      }

      const isEntrypointRef = definition.entrypoint.ref === action.ref;
      const isEntrypointComponent = action.componentId === 'core.workflow.entrypoint';

      if (isEntrypointRef && request.inputs) {
        // Only apply inputs to the actual entrypoint component, not just any node matching the entrypoint ref
        if (isEntrypointComponent) {
          console.log(
            `[WorkflowRunner] Applying inputs to entrypoint component '${action.ref}' (${action.componentId})`,
          );
          inputs.__runtimeData = request.inputs;
        } else {
          // Entrypoint ref points to a non-entrypoint component - this is a configuration error
          // Log warning but don't apply inputs to wrong component
          console.error(
            `[WorkflowRunner] CRITICAL: Entrypoint ref '${definition.entrypoint.ref}' points to component '${action.componentId}' instead of 'core.workflow.entrypoint'. ` +
              `Inputs will NOT be applied to this component. This indicates a workflow compilation error.`,
          );
        }
      } else if (request.inputs && Object.keys(request.inputs).length > 0) {
        // Log when inputs exist but are not being applied (for debugging)
        if (isEntrypointRef && !isEntrypointComponent) {
          console.warn(
            `[WorkflowRunner] Node '${action.ref}' matches entrypoint ref but is not an entrypoint component (${action.componentId}). Inputs skipped.`,
          );
        }
      }

      // Record node I/O start
      await options.nodeIO?.recordStart({
        runId,
        nodeRef: action.ref,
        workflowId: options.workflowId,
        organizationId: options.organizationId,
        componentId: action.componentId,
        inputs: maskSecretOutputs(inputPorts, inputs) as Record<string, unknown>,
      });

      const parsedInputs = component.inputs.parse(inputs);
      const parsedParams = component.parameters ? component.parameters.parse(params) : params;

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

      const allowSecrets = component.requiresSecrets === true;

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
        secrets: allowSecrets ? options.secrets : undefined,
        artifacts: scopedArtifacts,
        trace: options.trace,
        logCollector: forwardLog,
      });

      try {
        console.log(
          `⚡️ [WORKFLOW RUNNER] Executing component: ${action.componentId} for action: ${actionRef}`,
        );
        const rawOutput = await component.execute(
          { inputs: parsedInputs, params: parsedParams },
          context,
        );
        console.log(
          `✅ [WORKFLOW RUNNER] Component execution completed: ${action.componentId} for action: ${actionRef}`,
        );
        let output = component.outputs.parse(rawOutput);

        // Check for payload size and spill if necessary
        if (output && options.storage) {
          try {
            const outputStr = JSON.stringify(output);
            const size = Buffer.byteLength(outputStr, 'utf8');

            if (size > TEMPORAL_SPILL_THRESHOLD_BYTES) {
              const fileId = randomUUID();

              await options.storage.uploadFile(
                fileId,
                'output.json',
                Buffer.from(outputStr),
                'application/json',
              );

              // Replace output with standardized spilled marker
              output = {
                __spilled__: true,
                storageRef: fileId,
                originalSize: size,
              } as any;
            }
          } catch (err) {
            console.warn('[WorkflowRunner] Failed to check/spill output size', err);
          }
        }
        results.set(action.ref, output);
        console.log(`💾 [WORKFLOW RUNNER] Result stored for: ${actionRef}`);
        // Record node I/O completion
        await options.nodeIO?.recordCompletion({
          runId,
          nodeRef: action.ref,
          componentId: action.componentId,
          outputs: maskSecretOutputs(outputPorts, output) as Record<string, unknown>,
          status: 'completed',
        });

        options.trace?.record({
          type: 'NODE_COMPLETED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          outputSummary: createLightweightSummary(component, output),
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

        // Extract error properties without using 'any'
        let errorType: string | undefined;
        let errorDetails: Record<string, unknown> | undefined;
        let fieldErrors: Record<string, string[]> | undefined;

        if (error instanceof Error) {
          errorType = error.name;

          // Check if it's a ComponentError (has type property)
          if ('type' in error && typeof (error as { type: unknown }).type === 'string') {
            errorType = (error as { type: string }).type;
          }

          // Extract details if present
          if (
            'details' in error &&
            typeof (error as { details: unknown }).details === 'object' &&
            (error as { details: unknown }).details !== null
          ) {
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

        options.trace?.record({
          type: 'NODE_FAILED',
          runId,
          nodeRef: action.ref,
          timestamp: new Date().toISOString(),
          message: errorMsg,
          error: traceError,
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
        // Record node I/O failure
        await options.nodeIO?.recordCompletion({
          runId,
          nodeRef: action.ref,
          componentId: action.componentId,
          outputs: {}, // No successful output
          status: 'failed',
          errorMessage: errorMsg,
        });

        throw error;
      }

      // Return null as per the expected return type
      return null;
    };

    await runWorkflowWithScheduler(definition, {
      run: runAction,
    });

    console.log(`📊 [WORKFLOW RUNNER] runWorkflowWithScheduler completed for ${runId}`);
    console.log(`📊 [WORKFLOW RUNNER] Total results stored: ${results.size}`);

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

    console.log(`📊 [WORKFLOW RUNNER] Output keys: ${Object.keys(outputsObject).join(', ')}`);
    console.log(`📊 [WORKFLOW RUNNER] Reported failure: ${reportedFailure}`);

    if (reportedFailure) {
      const baseMessage = 'One or more workflow actions failed';
      console.error(
        `❌ [WORKFLOW RUNNER] Workflow failed: ${baseMessage}: ${failureDetails.join('; ')}`,
      );
      return {
        outputs: outputsObject,
        success: false,
        error:
          failureDetails.length > 0 ? `${baseMessage}: ${failureDetails.join('; ')}` : baseMessage,
      };
    }

    console.log(`✅ [WORKFLOW RUNNER] Workflow completed successfully for ${runId}`);
    return { outputs: outputsObject, success: true };
  } catch (error) {
    console.error(`❌ [WORKFLOW RUNNER] Workflow threw exception for ${runId}:`, error);
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

function maskSecretOutputs(outputPorts: ComponentPortMetadata[], output: unknown): unknown {
  const secretPorts =
    outputPorts.filter((port) => {
      const connectionType = port.connectionType;

      if (connectionType.kind === 'primitive') {
        return connectionType.name === 'secret';
      }
      if (connectionType.kind === 'contract') {
        return Boolean(connectionType.credential);
      }
      return false;
    }) ?? [];
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
