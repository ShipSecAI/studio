import {
  ApplicationFailure,
  condition,
  defineQuery,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  startChild,
  sleep,
  uuid4,
} from '@temporalio/workflow';
import type { ComponentRetryPolicy } from '@shipsec/component-sdk';
import { runWorkflowWithScheduler } from '../workflow-scheduler';
import { buildActionPayload } from '../input-resolver';
import {
  resolveHumanInputSignal,
  executeToolCallSignal,
  type HumanInputResolution,
  type ToolCallRequest,
  type ToolCallResult,
} from '../signals';
import type { ExecutionTriggerMetadata, PreparedRunPayload } from '@shipsec/shared';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
  PrepareRunPayloadActivityInput,
  RegisterComponentToolActivityInput,
  RegisterLocalMcpActivityInput,
  RegisterRemoteMcpActivityInput,
  PrepareAndRegisterToolActivityInput,
} from '../types';

const {
  runComponentActivity: _runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
  createHumanInputRequestActivity,
  expireHumanInputRequestActivity,
  registerLocalMcpActivity,
  registerRemoteMcpActivity,
  prepareAndRegisterToolActivity,
} = proxyActivities<{
  runComponentActivity(input: RunComponentActivityInput): Promise<RunComponentActivityOutput>;
  setRunMetadataActivity(input: {
    runId: string;
    workflowId: string;
    organizationId?: string | null;
  }): Promise<void>;
  finalizeRunActivity(input: { runId: string }): Promise<void>;
  createHumanInputRequestActivity(input: {
    runId: string;
    workflowId: string;
    nodeRef: string;
    inputType: 'approval' | 'form' | 'selection' | 'review' | 'acknowledge';
    inputSchema?: Record<string, unknown>;
    title: string;
    description?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
    organizationId?: string | null;
  }): Promise<{
    requestId: string;
    resolveToken: string;
    resolveUrl: string;
  }>;
  expireHumanInputRequestActivity(requestId: string): Promise<void>;
  registerComponentToolActivity(input: RegisterComponentToolActivityInput): Promise<void>;
  registerLocalMcpActivity(input: RegisterLocalMcpActivityInput): Promise<void>;
  registerRemoteMcpActivity(input: RegisterRemoteMcpActivityInput): Promise<void>;
  prepareAndRegisterToolActivity(input: PrepareAndRegisterToolActivityInput): Promise<void>;
}>({
  startToCloseTimeout: '10 minutes',
});

const { prepareRunPayloadActivity } = proxyActivities<{
  prepareRunPayloadActivity(input: PrepareRunPayloadActivityInput): Promise<PreparedRunPayload>;
}>({
  startToCloseTimeout: '2 minutes',
});

const { recordTraceEventActivity } = proxyActivities<{
  recordTraceEventActivity(event: any): Promise<void>;
}>({
  startToCloseTimeout: '1 minute',
});

/**
 * Check if an output indicates a pending approval gate
 */
function isApprovalPending(
  output: unknown,
): output is { pending: true; title: string; description?: string; timeoutAt?: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'pending' in output &&
    (output as { pending?: unknown }).pending === true
  );
}

function mapRetryPolicy(policy?: ComponentRetryPolicy) {
  if (!policy) return undefined;

  return {
    maximumAttempts: policy.maxAttempts,
    initialInterval: policy.initialIntervalSeconds
      ? policy.initialIntervalSeconds * 1000
      : undefined,
    maximumInterval: policy.maximumIntervalSeconds
      ? policy.maximumIntervalSeconds * 1000
      : undefined,
    backoffCoefficient: policy.backoffCoefficient,
    nonRetryableErrorTypes: policy.nonRetryableErrorTypes,
  };
}

export async function shipsecWorkflowRun(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  const results = new Map<string, unknown>();
  const actionsByRef = new Map<string, WorkflowAction>(
    input.definition.actions.map((action) => [action.ref, action]),
  );

  // Track pending human inputs and their resolutions
  const pendingHumanInputs = new Map<
    string,
    { nodeRef: string; resolve: (res: HumanInputResolution) => void }
  >();
  const humanInputResolutions = new Map<string, HumanInputResolution>();

  // Set up signal handler for human input resolutions
  setHandler(resolveHumanInputSignal, (resolution: HumanInputResolution) => {
    console.log(
      `[Workflow] Received human input signal for ${resolution.nodeRef}: approved=${resolution.approved}`,
    );
    humanInputResolutions.set(resolution.nodeRef, resolution);
    const pending = pendingHumanInputs.get(resolution.nodeRef);
    if (pending) {
      pending.resolve(resolution);
    }
  });

  // Track pending tool calls and their results (for MCP gateway)
  const pendingToolCalls = new Map<
    string,
    { request: ToolCallRequest; resolve: (result: ToolCallResult) => void }
  >();
  const toolCallResults = new Map<string, ToolCallResult>();

  // Set up signal handler for tool call execution requests
  setHandler(executeToolCallSignal, async (request: ToolCallRequest) => {
    console.log(
      `[Workflow] Received tool call signal: callId=${request.callId}, componentId=${request.componentId}`,
    );

    // Execute the component via runComponentActivity
    try {
      const activityOutput = await _runComponentActivity({
        runId: input.runId,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId,
        organizationId: input.organizationId,
        action: {
          ref: `tool-call:${request.callId}`,
          componentId: request.componentId,
        },
        // Merge credentials (pre-bound) with agent-provided arguments
        inputs: {
          ...(request.credentials ?? {}),
          ...request.arguments,
        },
        params: request.parameters ?? {},
        metadata: {
          streamId: request.callId,
        },
      });

      const result: ToolCallResult = {
        callId: request.callId,
        success: true,
        output: activityOutput.output,
        completedAt: new Date().toISOString(),
      };

      toolCallResults.set(request.callId, result);
      console.log(`[Workflow] Tool call completed: callId=${request.callId}, success=true`);

      // Resolve any pending waiters
      const pending = pendingToolCalls.get(request.callId);
      if (pending) {
        pending.resolve(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ToolCallResult = {
        callId: request.callId,
        success: false,
        error: errorMessage,
        completedAt: new Date().toISOString(),
      };

      toolCallResults.set(request.callId, result);
      console.log(`[Workflow] Tool call failed: callId=${request.callId}, error=${errorMessage}`);

      const pending = pendingToolCalls.get(request.callId);
      if (pending) {
        pending.resolve(result);
      }
    }
  });

  // Set up query handler for tool call results
  setHandler(
    defineQuery<ToolCallResult | null, [string]>('getToolCallResult'),
    (callId: string) => {
      return toolCallResults.get(callId) ?? null;
    },
  );

  console.log(`[Workflow] Starting shipsec workflow run: ${input.runId}`);
  console.log(
    `[Workflow] Definition actions:`,
    input.definition.actions.map((a) => a.ref),
  );

  const callChain =
    Array.isArray(input.callChain) && input.callChain.length > 0
      ? input.callChain
      : [input.workflowId];
  const depth = typeof input.depth === 'number' && Number.isFinite(input.depth) ? input.depth : 0;

  await setRunMetadataActivity({
    runId: input.runId,
    workflowId: input.workflowId,
    organizationId: input.organizationId ?? null,
  });

  try {
    await runWorkflowWithScheduler(input.definition, {
      onNodeSkipped: async (actionRef) => {
        console.log(`[Workflow] Node skipped: ${actionRef}`);
        await recordTraceEventActivity({
          type: 'NODE_SKIPPED',
          runId: input.runId,
          nodeRef: actionRef,
          timestamp: new Date().toISOString(),
          level: 'info',
          context: {
            activityId: 'workflow-orchestration',
          },
        });
      },
      run: async (actionRef, schedulerContext) => {
        console.log(`[Workflow] Running action ${actionRef} with context:`, schedulerContext);
        const action = actionsByRef.get(actionRef);
        if (!action) {
          throw ApplicationFailure.nonRetryable(`Action not found: ${actionRef}`, 'NotFoundError', [
            { resourceType: 'action', resourceId: actionRef },
          ]);
        }

        const { inputs, params, warnings } = buildActionPayload(action, results);
        const mergedInputs: Record<string, unknown> = { ...inputs };
        const mergedParams: Record<string, unknown> = { ...params };

        // Only apply inputs to the actual entrypoint component, not just any node matching the entrypoint ref
        const isEntrypointRef = input.definition.entrypoint.ref === action.ref;
        const isEntrypointComponent = action.componentId === 'core.workflow.entrypoint';

        if (isEntrypointRef && input.inputs) {
          if (isEntrypointComponent) {
            console.log(
              `[Workflow] Applying inputs to entrypoint component '${action.ref}' (${action.componentId})`,
            );
            mergedInputs.__runtimeData = input.inputs;
          } else {
            // Entrypoint ref points to a non-entrypoint component - this is a configuration error
            // Log warning but don't apply inputs to wrong component
            console.error(
              `[Workflow] CRITICAL: Entrypoint ref '${input.definition.entrypoint.ref}' points to component '${action.componentId}' instead of 'core.workflow.entrypoint'. ` +
                `Inputs will NOT be applied to this component. This indicates a workflow compilation error.`,
            );
          }
        } else if (input.inputs && Object.keys(input.inputs).length > 0) {
          // Log when inputs exist but are not being applied (for debugging)
          if (isEntrypointRef && !isEntrypointComponent) {
            console.warn(
              `[Workflow] Node '${action.ref}' matches entrypoint ref but is not an entrypoint component (${action.componentId}). Inputs skipped.`,
            );
          }
        }

        if (action.componentId === 'core.workflow.call') {
          const MAX_SUBWORKFLOW_DEPTH = 10;

          if (depth >= MAX_SUBWORKFLOW_DEPTH) {
            throw ApplicationFailure.nonRetryable(
              `Maximum sub-workflow nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`,
              'SubWorkflowDepthError',
              [{ runId: input.runId, nodeRef: action.ref, depth }],
            );
          }

          for (const warning of warnings) {
            await recordTraceEventActivity({
              type: 'NODE_PROGRESS',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              message: `Input '${warning.target}' mapped from ${warning.sourceRef}.${warning.sourceHandle} was undefined`,
              level: 'warn',
              data: warning,
              context: {
                activityId: 'workflow-orchestration',
              },
            });
          }

          if (warnings.length > 0) {
            const missing = warnings.map((warning) => `'${warning.target}'`).join(', ');
            throw ApplicationFailure.nonRetryable(
              `Missing required inputs for ${action.ref}: ${missing}`,
              'ValidationError',
              [{ runId: input.runId, nodeRef: action.ref }],
            );
          }

          const childWorkflowId = mergedParams.workflowId;
          if (typeof childWorkflowId !== 'string' || childWorkflowId.trim().length === 0) {
            throw ApplicationFailure.nonRetryable(
              'core.workflow.call requires a workflowId parameter',
              'ValidationError',
              [{ runId: input.runId, nodeRef: action.ref }],
            );
          }

          if (callChain.includes(childWorkflowId)) {
            throw ApplicationFailure.nonRetryable(
              `Circular sub-workflow call detected for workflow ${childWorkflowId}`,
              'SubWorkflowCycleError',
              [{ runId: input.runId, nodeRef: action.ref, callChain }],
            );
          }

          const versionStrategy =
            mergedParams.versionStrategy === 'specific' ? 'specific' : 'latest';
          const versionIdRaw = mergedParams.versionId;
          const versionId =
            versionStrategy === 'specific' &&
            typeof versionIdRaw === 'string' &&
            versionIdRaw.trim().length > 0
              ? versionIdRaw.trim()
              : undefined;

          if (versionStrategy === 'specific' && !versionId) {
            throw ApplicationFailure.nonRetryable(
              'versionId is required when versionStrategy is "specific"',
              'ValidationError',
              [{ runId: input.runId, nodeRef: action.ref }],
            );
          }

          const timeoutSecondsRaw = mergedParams.timeoutSeconds;
          const timeoutSeconds =
            typeof timeoutSecondsRaw === 'number' &&
            Number.isFinite(timeoutSecondsRaw) &&
            timeoutSecondsRaw > 0
              ? Math.floor(timeoutSecondsRaw)
              : 300;

          const childRuntimeInputsRaw = mergedParams.childRuntimeInputs;
          const childRuntimeInputs = Array.isArray(childRuntimeInputsRaw)
            ? childRuntimeInputsRaw
            : [];
          const childInputIds = childRuntimeInputs
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return undefined;
              }
              const id = (entry as Record<string, unknown>).id;
              return typeof id === 'string' ? id : undefined;
            })
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim());

          const reservedIds = new Set([
            'workflowId',
            'versionStrategy',
            'versionId',
            'timeoutSeconds',
            'childRuntimeInputs',
            'childWorkflowName',
          ]);

          const childInputs: Record<string, unknown> = {};
          for (const id of childInputIds) {
            if (reservedIds.has(id)) continue;
            childInputs[id] = mergedInputs[id];
          }

          const childRunId = `shipsec-run-${uuid4()}`;

          await recordTraceEventActivity({
            type: 'NODE_STARTED',
            runId: input.runId,
            nodeRef: action.ref,
            timestamp: new Date().toISOString(),
            level: 'info',
            context: {
              activityId: 'workflow-orchestration',
              childRunId,
            },
          });

          let prepared: PreparedRunPayload;
          try {
            prepared = await prepareRunPayloadActivity({
              workflowId: childWorkflowId,
              versionId,
              inputs: childInputs,
              trigger: {
                type: 'api',
                sourceId: input.runId,
                label: `Sub-workflow from ${input.workflowId}:${action.ref}`,
              },
              organizationId: input.organizationId ?? null,
              runId: childRunId,
              parentRunId: input.runId,
              parentNodeRef: action.ref,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await recordTraceEventActivity({
              type: 'NODE_FAILED',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              message,
              level: 'error',
              error: {
                message,
                type: 'SubWorkflowPrepareError',
                details: { childRunId },
              },
              context: {
                activityId: 'workflow-orchestration',
                childRunId,
              },
            });
            throw error;
          }

          const child = await startChild(shipsecWorkflowRun, {
            args: [
              {
                runId: prepared.runId,
                workflowId: prepared.workflowId,
                definition: prepared.definition as RunWorkflowActivityInput['definition'],
                inputs: prepared.inputs ?? {},
                workflowVersionId: prepared.workflowVersionId,
                workflowVersion: prepared.workflowVersion,
                organizationId: prepared.organizationId,
                parentRunId: input.runId,
                parentNodeRef: action.ref,
                depth: depth + 1,
                callChain: [...callChain, childWorkflowId],
              },
            ],
            workflowId: prepared.runId,
          });

          const timeoutMs = timeoutSeconds * 1000;
          let outcome:
            | { kind: 'result'; result: Awaited<ReturnType<typeof child.result>> }
            | { kind: 'timeout' };
          try {
            outcome = await Promise.race([
              child.result().then((result) => ({ kind: 'result' as const, result })),
              sleep(timeoutMs).then(() => ({ kind: 'timeout' as const })),
            ]);
          } catch (childError) {
            // child.result() rejects when the child workflow throws (shipsecWorkflowRun
            // always throws on failure rather than returning { success: false }).
            // Record NODE_FAILED so the UI shows the node as failed instead of stuck running.
            const message = childError instanceof Error ? childError.message : String(childError);
            await recordTraceEventActivity({
              type: 'NODE_FAILED',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              message,
              level: 'error',
              error: {
                message,
                type: 'SubWorkflowError',
                details: { childRunId },
              },
              context: {
                activityId: 'workflow-orchestration',
                childRunId,
              },
            });
            throw childError;
          }

          if (outcome.kind === 'timeout') {
            const externalHandle = getExternalWorkflowHandle(child.workflowId);
            await externalHandle.cancel();

            await recordTraceEventActivity({
              type: 'NODE_FAILED',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              message: `Sub-workflow timed out after ${timeoutSeconds}s`,
              level: 'error',
              error: {
                message: `Sub-workflow timed out after ${timeoutSeconds}s`,
                type: 'TimeoutError',
                details: { timeoutSeconds, childRunId },
              },
              context: {
                activityId: 'workflow-orchestration',
                childRunId,
              },
            });

            throw ApplicationFailure.nonRetryable(
              `Sub-workflow timed out after ${timeoutSeconds}s`,
              'TimeoutError',
              [{ runId: input.runId, nodeRef: action.ref, childRunId, timeoutSeconds }],
            );
          }

          const childResult = outcome.result;
          if (!childResult.success) {
            const message = childResult.error ?? 'Sub-workflow failed';

            await recordTraceEventActivity({
              type: 'NODE_FAILED',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              message,
              level: 'error',
              error: {
                message,
                type: 'SubWorkflowFailure',
                details: { childRunId },
              },
              context: {
                activityId: 'workflow-orchestration',
                childRunId,
              },
            });

            throw ApplicationFailure.nonRetryable(message, 'SubWorkflowFailure', [
              { runId: input.runId, nodeRef: action.ref, childRunId },
            ]);
          }

          const nodeOutput = {
            result: childResult.outputs,
            childRunId,
          };

          results.set(action.ref, nodeOutput);

          await recordTraceEventActivity({
            type: 'NODE_COMPLETED',
            runId: input.runId,
            nodeRef: action.ref,
            timestamp: new Date().toISOString(),
            outputSummary: nodeOutput,
            level: 'info',
            context: {
              activityId: 'workflow-orchestration',
              childRunId,
            },
          });

          return {};
        }

        const nodeMetadata = input.definition.nodes?.[action.ref];
        const streamId = nodeMetadata?.streamId ?? nodeMetadata?.groupId ?? action.ref;
        const joinStrategy = nodeMetadata?.joinStrategy ?? schedulerContext.joinStrategy;
        const { triggeredBy, failure } = schedulerContext;

        const activityInput: RunComponentActivityInput = {
          runId: input.runId,
          workflowId: input.workflowId,
          workflowVersionId: input.workflowVersionId ?? null,
          organizationId: input.organizationId ?? null,
          action: {
            ref: action.ref,
            componentId: action.componentId,
          },
          inputs: mergedInputs,
          params: mergedParams,
          warnings,
          metadata: {
            streamId,
            joinStrategy,
            groupId: nodeMetadata?.groupId,
            triggeredBy,
            failure,
          },
        };

        const retryOptions = mapRetryPolicy(action.retryPolicy);

        const isToolMode = nodeMetadata?.mode === 'tool';

        if (isToolMode) {
          if (action.componentId === 'core.mcp.server') {
            const { runComponentActivity: runMcp } = proxyActivities<{
              runComponentActivity(
                input: RunComponentActivityInput,
              ): Promise<RunComponentActivityOutput>;
            }>({
              startToCloseTimeout: '10 minutes',
              retry: retryOptions,
            });

            const mcpOutput = await runMcp(activityInput);
            const output = mcpOutput.output as any;
            const endpoint = output.endpoint;
            const containerId = output.containerId;

            if (mergedParams.type === 'docker' || mergedParams.image) {
              await registerLocalMcpActivity({
                runId: input.runId,
                nodeId: action.ref,
                toolName:
                  (mergedParams.image as string)?.split('/').pop()?.split(':')[0] || 'mcp_server',
                description: `Local MCP Server (${mergedParams.image})`,
                inputSchema: {},
                image: mergedParams.image as string,
                port: (mergedParams.port as number) || 8080,
                endpoint,
                containerId,
              });
            } else {
              await registerRemoteMcpActivity({
                runId: input.runId,
                nodeId: action.ref,
                toolName: 'remote_mcp',
                description: `Remote MCP Server (${endpoint})`,
                inputSchema: {},
                endpoint: endpoint as string,
                authToken: mergedParams.authToken as string,
              });
            }
          } else {
            await prepareAndRegisterToolActivity({
              runId: input.runId,
              nodeId: action.ref,
              componentId: action.componentId,
              inputs: mergedInputs,
              params: mergedParams,
            });
          }

          // Tool registration is successful, proceed as a successful node execution
          return { activePorts: ['default'] };
        }

        const { runComponentActivity: runComponentWithRetry } = proxyActivities<{
          runComponentActivity(
            input: RunComponentActivityInput,
          ): Promise<RunComponentActivityOutput>;
        }>({
          startToCloseTimeout: '10 minutes',
          retry: retryOptions,
        });

        const output = await runComponentWithRetry(activityInput);

        // Check if this is a pending human input request (approval gate, form, choice, etc.)
        if (isApprovalPending(output.output)) {
          console.log(
            `[Workflow] Pending human input detected at ${action.ref} (type=${(output.output as any).inputType ?? 'approval'})`,
          );

          const pendingData = output.output as any;

          // Create the human input request in the database
          const approvalResult = await createHumanInputRequestActivity({
            runId: input.runId,
            workflowId: input.workflowId,
            nodeRef: action.ref,
            inputType: pendingData.inputType ?? 'approval',
            title: pendingData.title,
            description: pendingData.description,
            context:
              pendingData.contextData ??
              (mergedParams.data ? { data: mergedParams.data } : undefined),
            inputSchema:
              pendingData.inputSchema ??
              (pendingData.options
                ? { options: pendingData.options, multiple: pendingData.multiple }
                : undefined) ??
              (pendingData.schema ? { schema: pendingData.schema } : undefined),
            timeoutMs: pendingData.timeoutAt
              ? new Date(pendingData.timeoutAt).getTime() - Date.now()
              : undefined,
            organizationId: input.organizationId ?? null,
          });

          console.log(
            `[Workflow] Created human input request ${approvalResult.requestId} for ${action.ref}`,
          );

          // Check if we already have a resolution (signal arrived before we started waiting)
          let resolution = humanInputResolutions.get(action.ref);

          if (!resolution) {
            // Wait for the human input signal
            console.log(`[Workflow] Waiting for human input signal for ${action.ref}...`);

            // Calculate timeout duration
            const timeoutMs = pendingData.timeoutAt
              ? Math.max(0, new Date(pendingData.timeoutAt).getTime() - Date.now())
              : undefined;

            // Wait for signal or timeout
            let signalReceived: boolean;
            if (timeoutMs !== undefined) {
              signalReceived = await condition(
                () => humanInputResolutions.has(action.ref),
                timeoutMs,
              );
            } else {
              // No timeout - wait indefinitely
              await condition(() => humanInputResolutions.has(action.ref));
              signalReceived = true;
            }

            if (!signalReceived) {
              // Timeout occurred
              console.log(`[Workflow] Human input timeout for ${action.ref}`);
              await expireHumanInputRequestActivity(approvalResult.requestId);
              throw ApplicationFailure.nonRetryable(
                `Human input request timed out for node ${action.ref}`,
                'TimeoutError',
                [{ nodeRef: action.ref, requestId: approvalResult.requestId, timeoutMs }],
              );
            }

            resolution = humanInputResolutions.get(action.ref)!;
          }

          console.log(
            `[Workflow] Human input resolved for ${action.ref}: approved=${resolution.approved}`,
          );

          // Store the final result (merging in responseData for dynamic ports)
          // Include both 'approved' and 'rejected' fields so downstream nodes can consume either port's data
          results.set(action.ref, {
            approved: resolution.approved,
            rejected: !resolution.approved,
            respondedBy: resolution.respondedBy,
            responseNote: resolution.responseNote,
            respondedAt: resolution.respondedAt,
            requestId: approvalResult.requestId,
            ...(typeof resolution.responseData === 'object' ? resolution.responseData : {}),
          });

          // Determine active ports based on resolution
          const activePorts: string[] = ['respondedBy', 'responseNote', 'respondedAt', 'requestId'];

          const inputType = (pendingData.inputType ?? 'approval') as string;

          if (inputType === 'approval' || inputType === 'review') {
            // Standard approval gating
            activePorts.push(resolution.approved ? 'approved' : 'rejected');
          } else if (inputType === 'selection') {
            // Activate ports for selected options
            const selection = (resolution.responseData as any)?.selection;
            if (selection !== undefined && selection !== null) {
              activePorts.push('selection');
              if (Array.isArray(selection)) {
                selection.forEach((val: string) => activePorts.push(`option:${val}`));
              } else if (typeof selection === 'string') {
                activePorts.push(`option:${selection}`);
              }
            }

            if (resolution.approved) {
              activePorts.push('approved');
            } else {
              activePorts.push('rejected');
            }
          } else {
            // Fallback for form/acknowledge
            if (resolution.approved) {
              activePorts.push('approved');
            } else {
              activePorts.push('rejected');
            }
          }

          // Explicitly mark the node as completed via trace (since we suppressed it earlier)
          await recordTraceEventActivity({
            type: 'NODE_COMPLETED',
            runId: input.runId,
            nodeRef: action.ref,
            timestamp: new Date().toISOString(),
            outputSummary: results.get(action.ref),
            data: { activatedPorts: activePorts },
            level: 'info',
            context: {
              activityId: 'workflow-orchestration',
            },
          });

          // Return active ports to scheduler for conditional execution
          return { activePorts };
        } else {
          // Normal component - just store the result
          results.set(action.ref, output.output);

          // Return any active ports returned by the component activity
          return { activePorts: output.activeOutputPorts };
        }
      },
    });

    // Check if any component returned a failure status
    const outputs = Object.fromEntries(results);
    const failedComponents: { ref: string; error: string }[] = [];

    for (const [ref, output] of results.entries()) {
      if (isComponentFailure(output)) {
        const errorMessage = extractFailureMessage(output);
        failedComponents.push({ ref, error: errorMessage });
      }
    }

    if (failedComponents.length > 0) {
      const failureDetails = failedComponents
        .map(({ ref, error }) => `[${ref}] ${error}`)
        .join('; ');
      const errorMessage = `Workflow failed: ${failureDetails}`;

      console.error(`[Workflow] ${errorMessage}`);

      throw ApplicationFailure.nonRetryable(errorMessage, 'ComponentFailure', [
        { outputs, failedComponents },
      ]);
    }

    return {
      outputs,
      success: true,
    };
  } catch (error) {
    const outputs = Object.fromEntries(results);
    const normalizedError =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : JSON.stringify(error));

    throw ApplicationFailure.nonRetryable(
      normalizedError.message,
      normalizedError.name ?? 'WorkflowFailure',
      [{ outputs, error: normalizedError.message }],
    );
  } finally {
    await finalizeRunActivity({ runId: input.runId }).catch((err) => {
      console.error(`[Workflow] Failed to finalize run ${input.runId}`, err);
    });
  }
}

/**
 * Check if a component output represents a failure
 */
function isComponentFailure(value: unknown): value is { success: boolean; error?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success?: unknown }).success === false
  );
}

/**
 * Extract error message from a failed component output
 */
function extractFailureMessage(value: { success: boolean; error?: unknown }): string {
  if (!value) {
    return 'Component reported failure';
  }
  const errorMessage = value.error;
  if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
    return errorMessage;
  }
  if (errorMessage && typeof errorMessage === 'object') {
    return JSON.stringify(errorMessage);
  }
  return 'Component reported failure';
}

export async function minimalWorkflow(): Promise<string> {
  return 'minimal workflow executed successfully';
}

export async function testMinimalWorkflow(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  return shipsecWorkflowRun(input);
}

export interface ScheduleTriggerWorkflowInput {
  workflowId: string;
  workflowVersionId?: string | null;
  workflowVersion?: number | null;
  organizationId?: string | null;
  scheduleId?: string;
  scheduleName?: string | null;
  runtimeInputs?: Record<string, unknown>;
  nodeOverrides?: Record<
    string,
    { params?: Record<string, unknown>; inputOverrides?: Record<string, unknown> }
  >;
  trigger?: ExecutionTriggerMetadata;
}

export async function scheduleTriggerWorkflow(
  input: ScheduleTriggerWorkflowInput,
): Promise<RunWorkflowActivityOutput> {
  const triggerMetadata =
    input.trigger ??
    ({
      type: 'schedule',
      sourceId: input.scheduleId,
      label: input.scheduleName ?? 'Scheduled run',
    } satisfies ExecutionTriggerMetadata);

  const runId = `shipsec-run-${uuid4()}`;

  const prepared = await prepareRunPayloadActivity({
    workflowId: input.workflowId,
    versionId: input.workflowVersionId ?? undefined,
    version: input.workflowVersion ?? undefined,
    inputs: input.runtimeInputs ?? {},
    nodeOverrides: input.nodeOverrides ?? {},
    trigger: triggerMetadata,
    organizationId: input.organizationId ?? null,
    runId,
  });

  const child = await startChild(shipsecWorkflowRun, {
    args: [
      {
        runId: prepared.runId,
        workflowId: prepared.workflowId,
        definition: prepared.definition as RunWorkflowActivityInput['definition'],
        inputs: prepared.inputs ?? {},
        workflowVersionId: prepared.workflowVersionId,
        workflowVersion: prepared.workflowVersion,
        organizationId: prepared.organizationId,
      },
    ],
    workflowId: prepared.runId,
  });

  return child.result();
}
