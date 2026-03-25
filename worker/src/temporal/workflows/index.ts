import {
  ApplicationFailure,
  condition,
  getExternalWorkflowHandle,
  proxyActivities,
  setHandler,
  startChild,
  sleep,
  uuid4,
} from '@temporalio/workflow';
import type { ComponentRetryPolicy } from '@shipsec/component-sdk';

// Run context merge constants (mirrored from @shipsec/component-sdk/context to avoid
// pulling the full SDK into the Temporal workflow sandbox bundle)
const RUN_CONTEXT_ALLOWED_KEYS = new Set([
  'repository',
  'branch',
  'commitSha',
  'provider',
  'accountId',
  'connectionName',
]);
const RUN_CONTEXT_MAX_VALUE_LENGTH = 256;
const RUN_CONTEXT_MAX_ENTRIES = 16;
import { runWorkflowWithScheduler } from '../workflow-scheduler.js';
import { buildActionPayload } from '../input-resolver.js';
import { resolveHumanInputSignal, type HumanInputResolution } from '../signals.js';
import type { ExecutionTriggerMetadata, PreparedRunPayload } from '@shipsec/shared';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
  PrepareRunPayloadActivityInput,
  RegisterComponentToolActivityInput,
  CleanupRunResourcesActivityInput,
  RegisterLocalMcpActivityInput,
  PrepareAndRegisterToolActivityInput,
} from '../types';
import type { McpGroupAttachmentSpec } from '../../components/core/mcp-group-runtime.js';

const {
  runComponentActivity: _runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
  createHumanInputRequestActivity,
  expireHumanInputRequestActivity,
  registerLocalMcpActivity,
  cleanupRunResourcesActivity,
  prepareAndRegisterToolActivity,
  createHotplugSessionActivity,
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
  cleanupRunResourcesActivity(input: CleanupRunResourcesActivityInput): Promise<void>;
  prepareAndRegisterToolActivity(input: PrepareAndRegisterToolActivityInput): Promise<void>;
  createHotplugSessionActivity(input: {
    runId: string;
    organizationId: string;
    componentToolsEndpoint?: string;
    mcpGroupAttachments?: McpGroupAttachmentSpec[];
    remoteMcpAttachments?: { alias: string; url: string; headers?: Record<string, string> }[];
  }): Promise<{ sessionId: string; mcpUrl: string; mcpToken: string }>;
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

const MCP_SERVER_COMPONENTS: Record<
  string,
  { toolName: (params: Record<string, unknown>) => string; description: string }
> = {
  'core.mcp.server': {
    toolName: (params) => {
      const image = typeof params.image === 'string' ? params.image : '';
      return image.split('/').pop()?.split(':')[0] || 'mcp_server';
    },
    description: 'Local MCP Server',
  },
  'security.aws-cloudtrail-mcp': {
    toolName: () => 'aws_cloudtrail_mcp',
    description: 'AWS CloudTrail MCP Server',
  },
  'security.aws-cloudwatch-mcp': {
    toolName: () => 'aws_cloudwatch_mcp',
    description: 'AWS CloudWatch MCP Server',
  },
};

const MCP_GROUP_COMPONENTS = ['mcp.group.aws'];

function isMcpServerComponent(componentId: string): boolean {
  return componentId in MCP_SERVER_COMPONENTS;
}

function isMcpGroupComponent(componentId: string): boolean {
  return MCP_GROUP_COMPONENTS.includes(componentId);
}

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

  // Run-level shared context: components contribute via contributeRunContext,
  // workflow merges first-writer-wins after each activity completes.
  const runContext: Record<string, string> = {};

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

  // Track MCP group attachment specs collected during tool-mode node execution.
  // These are passed to createHotplugSessionActivity when an agent node starts.
  const mcpGroupAttachments: McpGroupAttachmentSpec[] = [];

  // Track the Hotplug session created for this run (one session shared across all agent nodes).
  let hotplugSession: { sessionId: string; mcpUrl: string; mcpToken: string } | null = null;

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

  // Track workflow completion for cleanup decision
  let workflowCompletedSuccessfully = true;

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
          workflowName: input.definition.title,
          workflowVersionId: input.workflowVersionId ?? null,
          organizationId: input.organizationId ?? null,
          triggerType: input.triggerType ?? null,
          triggerSource: input.triggerSource ?? null,
          runContext: { ...runContext },
          action: {
            ref: action.ref,
            componentId: action.componentId,
          },
          inputs: mergedInputs,
          params: mergedParams,
          inputOverrides: action.inputOverrides,
          rawParams: action.params,
          warnings,
          metadata: {
            streamId,
            joinStrategy,
            groupId: nodeMetadata?.groupId,
            triggeredBy,
            failure,
            connectedToolNodeIds: nodeMetadata?.connectedToolNodeIds,
          },
        };

        const retryOptions = mapRetryPolicy(action.retryPolicy);

        const isToolMode = nodeMetadata?.mode === 'tool';

        // MCP groups in tool mode should execute normally (not skip execution)
        // They will register individual servers as separate tools during execution
        const isMcpGroup = isMcpGroupComponent(action.componentId);
        const shouldSkipExecution = isToolMode && !isMcpGroup;

        if (shouldSkipExecution) {
          console.log(`[Workflow] Node ${action.ref} is in tool mode, registering...`);

          // Track any started containers for cleanup on failure
          let startedContainerId: string | undefined;

          try {
            if (isMcpServerComponent(action.componentId)) {
              const { runComponentActivity: runMcp } = proxyActivities<{
                runComponentActivity(
                  input: RunComponentActivityInput,
                ): Promise<RunComponentActivityOutput>;
              }>({
                startToCloseTimeout: '60 minutes',
                retry: retryOptions,
              });

              const mcpOutput = await runMcp(activityInput);
              const output = mcpOutput.output as any;
              const endpoint = output.endpoint;
              const sessionId = output.sessionId as string | undefined;

              if (!endpoint) {
                throw new Error('MCP server output missing endpoint');
              }

              startedContainerId = sessionId ?? endpoint;

              const mcpMeta = MCP_SERVER_COMPONENTS[action.componentId];
              const toolName = mcpMeta.toolName(mergedParams);
              const description = mcpMeta.description;

              await registerLocalMcpActivity({
                runId: input.runId,
                nodeId: action.ref,
                toolName,
                description,
                inputSchema: {},
                image: (mergedParams.image as string) || 'unknown',
                port: (mergedParams.port as number) || 8080,
                endpoint,
                sessionId,
              });
            } else {
              await prepareAndRegisterToolActivity({
                runId: input.runId,
                nodeId: action.ref,
                componentId: action.componentId,
                inputs: mergedInputs,
                params: mergedParams,
              });
            }

            console.log(`[Workflow] Node ${action.ref} registered as tool, setting results.`);
            const toolResult = { mode: 'tool', status: 'ready', tools: [] };
            results.set(action.ref, toolResult);

            await recordTraceEventActivity({
              type: 'NODE_COMPLETED',
              runId: input.runId,
              nodeRef: action.ref,
              timestamp: new Date().toISOString(),
              outputSummary: toolResult,
              level: 'info',
            });

            return { activePorts: ['default', 'tools'] };
          } catch (error) {
            // Cleanup any MCP containers that were started before failure
            if (startedContainerId) {
              console.warn(
                `[Workflow] Cleaning up run resources after MCP registration failure (container: ${startedContainerId})`,
              );
              try {
                await cleanupRunResourcesActivity({ runId: input.runId });
              } catch (cleanupError) {
                console.error(`[Workflow] Failed to cleanup run resources: ${cleanupError}`);
              }
            }
            throw error;
          }
        }

        if (isMcpServerComponent(action.componentId)) {
          throw ApplicationFailure.nonRetryable(
            `Component ${action.componentId} is tool-mode only`,
            'ToolModeOnly',
          );
        }

        const { runComponentActivity: runComponentWithRetry } = proxyActivities<{
          runComponentActivity(
            input: RunComponentActivityInput,
          ): Promise<RunComponentActivityOutput>;
        }>({
          startToCloseTimeout: '60 minutes',
          retry: retryOptions,
        });

        // If this node has tool dependencies, create a Hotplug session now (once per workflow run).
        // All tool-mode nodes (component tools + MCP groups) must have completed before
        // this node runs, because the scheduler enforces data dependency ordering.
        // Hotplug blocks internally until all attachments are ready.
        if (nodeMetadata?.connectedToolNodeIds && nodeMetadata.connectedToolNodeIds.length > 0) {
          if (!hotplugSession) {
            console.log(
              `[Workflow] Node ${action.ref} has tool dependencies, creating Hotplug session...`,
            );
            hotplugSession = await createHotplugSessionActivity({
              runId: input.runId,
              organizationId: input.organizationId ?? 'system',
              mcpGroupAttachments: mcpGroupAttachments.length > 0 ? mcpGroupAttachments : undefined,
            });
            console.log(
              `[Workflow] Hotplug session created: ${hotplugSession.sessionId}, url: ${hotplugSession.mcpUrl}`,
            );
          }
          // Inject Hotplug session URL and token into the activity metadata so
          // the agent component can connect directly to Hotplug.
          activityInput.metadata = {
            ...activityInput.metadata,
            hotplugMcpUrl: hotplugSession.mcpUrl,
            hotplugMcpToken: hotplugSession.mcpToken,
          };
          console.log(`[Workflow] Injected Hotplug metadata: url=${hotplugSession.mcpUrl}`);
        }

        // Debug logging: Track component execution start
        console.log(
          `[Workflow] Executing component ${action.componentId} (node ${action.ref})${isMcpGroup ? ' [MCP Group]' : ''}${isToolMode ? ' [Tool Mode]' : ''}`,
        );

        let output: RunComponentActivityOutput;
        try {
          output = await runComponentWithRetry(activityInput);
        } catch (activityError) {
          // Emit NODE_FAILED at the workflow level as a safety net.
          // When Temporal kills an activity (e.g. startToCloseTimeout), the activity's
          // own catch block never runs, so no NODE_FAILED trace event is recorded.
          // This ensures the node always gets a terminal trace event.
          const errorMsg =
            activityError instanceof Error ? activityError.message : String(activityError);
          console.error(`[Workflow] Activity failed for node ${action.ref}: ${errorMsg}`);
          await recordTraceEventActivity({
            type: 'NODE_FAILED',
            runId: input.runId,
            nodeRef: action.ref,
            timestamp: new Date().toISOString(),
            message: errorMsg,
            error: {
              message: errorMsg,
              type: activityError instanceof Error ? activityError.name : 'ActivityFailure',
            },
            level: 'error',
            context: {
              activityId: 'workflow-orchestration-safety-net',
            },
          }).catch((traceErr) => {
            console.error(
              `[Workflow] Failed to record NODE_FAILED trace for ${action.ref}:`,
              traceErr,
            );
          });
          throw activityError;
        }

        // MCP groups in tool mode: collect attachment specs from the component output.
        // These are passed to createHotplugSessionActivity when the agent node starts.
        if (isToolMode && isMcpGroup) {
          const groupOutput = output.output as { attachmentSpecs?: McpGroupAttachmentSpec[] };
          if (groupOutput?.attachmentSpecs && groupOutput.attachmentSpecs.length > 0) {
            console.log(
              `[Workflow] MCP Group node ${action.ref} returned ${groupOutput.attachmentSpecs.length} attachment spec(s)`,
            );
            mcpGroupAttachments.push(...groupOutput.attachmentSpecs);
          } else {
            console.log(
              `[Workflow] MCP Group node ${action.ref} returned no attachment specs (no enabled servers)`,
            );
          }
        }

        // Merge run context contributions (first-writer-wins, defense-in-depth guards)
        if (output.runContextContributions) {
          for (const [key, value] of Object.entries(output.runContextContributions)) {
            if (!RUN_CONTEXT_ALLOWED_KEYS.has(key)) continue;
            if (!value || typeof value !== 'string') continue;
            if (value.length > RUN_CONTEXT_MAX_VALUE_LENGTH) continue;
            if (Object.keys(runContext).length >= RUN_CONTEXT_MAX_ENTRIES) break;
            if (!(key in runContext)) {
              runContext[key] = value;
            }
          }
        }

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
    workflowCompletedSuccessfully = false;
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
    console.log(
      `[Workflow] Cleaning up run resources (containers + volumes) for run ${input.runId} (success=${workflowCompletedSuccessfully})`,
    );
    await cleanupRunResourcesActivity({ runId: input.runId }).catch((err) => {
      console.error(`[Workflow] Failed to cleanup run resources for run ${input.runId}`, err);
    });
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

/**
 * Lightweight workflow for executing a single component tool call.
 * Called by the backend ComponentToolMcpService via Temporal client.execute().
 * Replaces the old signal/poll pattern for component tool execution.
 */
export interface ExecuteComponentToolInput {
  runId: string;
  workflowId: string;
  workflowVersionId?: string | null;
  organizationId?: string | null;
  nodeId: string;
  componentId: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export async function executeComponentToolWorkflow(
  input: ExecuteComponentToolInput,
): Promise<{ success: boolean; output?: unknown; error?: string }> {
  try {
    const activityOutput = await _runComponentActivity({
      runId: input.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      organizationId: input.organizationId,
      triggerType: null,
      triggerSource: null,
      runContext: {},
      action: {
        ref: `tool-call:${input.nodeId}`,
        componentId: input.componentId,
      },
      inputs: {
        ...(input.credentials ?? {}),
        ...input.inputs,
      },
      params: input.params,
      inputOverrides: input.credentials ?? {},
      metadata: {},
    });

    return {
      success: true,
      output: activityOutput.output,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
        triggerType: prepared.trigger?.type ?? null,
        triggerSource: prepared.trigger?.sourceId,
      },
    ],
    workflowId: prepared.runId,
  });

  return child.result();
}

// Export MCP discovery workflow
export { mcpDiscoveryWorkflow, mcpGroupDiscoveryWorkflow } from './mcp-discovery-workflow.js';

// Export webhook parsing workflow (Docker execution must run in worker).
export { webhookParsingWorkflow } from './webhook-parsing-workflow.js';

// Export asset sync workflow (cloud inventory reconciliation).
export { assetSyncWorkflow } from './asset-sync-workflow.js';

// Export chat agent workflow
export { chatAgentWorkflow } from './chat-agent.workflow.js';
