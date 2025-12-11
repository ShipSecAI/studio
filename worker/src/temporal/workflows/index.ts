import { ApplicationFailure, proxyActivities, startChild, uuid4 } from '@temporalio/workflow';
import { runWorkflowWithScheduler } from '../workflow-scheduler';
import { buildActionParams } from '../input-resolver';
import type { ExecutionTriggerMetadata, PreparedRunPayload } from '@shipsec/shared';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
  PrepareRunPayloadActivityInput,
} from '../types';

const {
  runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
} = proxyActivities<{
  runComponentActivity(input: RunComponentActivityInput): Promise<RunComponentActivityOutput>;
  setRunMetadataActivity(input: { runId: string; workflowId: string; organizationId?: string | null }): Promise<void>;
  finalizeRunActivity(input: { runId: string }): Promise<void>;
}>({
  startToCloseTimeout: '10 minutes',
});

const { prepareRunPayloadActivity } = proxyActivities<{
  prepareRunPayloadActivity(
    input: PrepareRunPayloadActivityInput,
  ): Promise<PreparedRunPayload>;
}>({
  startToCloseTimeout: '2 minutes',
});

export async function shipsecWorkflowRun(
  input: RunWorkflowActivityInput,
): Promise<RunWorkflowActivityOutput> {
  const results = new Map<string, unknown>();
  const actionsByRef = new Map<string, WorkflowAction>(
    input.definition.actions.map((action) => [action.ref, action]),
  );

  console.log(`[Workflow] Starting shipsec workflow run: ${input.runId}`);

  await setRunMetadataActivity({
    runId: input.runId,
    workflowId: input.workflowId,
    organizationId: input.organizationId ?? null,
  });

  try {
    await runWorkflowWithScheduler(input.definition, {
      run: async (actionRef, schedulerContext) => {
        const action = actionsByRef.get(actionRef);
        if (!action) {
          throw new Error(`Action not found: ${actionRef}`);
        }

        const { params, warnings } = buildActionParams(action, results);
        const mergedParams: Record<string, unknown> = { ...params };

        // Only apply inputs to the actual entrypoint component, not just any node matching the entrypoint ref
        const isEntrypointRef = input.definition.entrypoint.ref === action.ref;
        const isEntrypointComponent = action.componentId === 'core.workflow.entrypoint';
        
        if (isEntrypointRef && input.inputs) {
          if (isEntrypointComponent) {
            console.log(
              `[Workflow] Applying inputs to entrypoint component '${action.ref}' (${action.componentId})`
            );
            mergedParams.__runtimeData = input.inputs;
          } else {
            // Entrypoint ref points to a non-entrypoint component - this is a configuration error
            // Log warning but don't apply inputs to wrong component
            console.error(
              `[Workflow] CRITICAL: Entrypoint ref '${input.definition.entrypoint.ref}' points to component '${action.componentId}' instead of 'core.workflow.entrypoint'. ` +
              `Inputs will NOT be applied to this component. This indicates a workflow compilation error.`
            );
          }
        } else if (input.inputs && Object.keys(input.inputs).length > 0) {
          // Log when inputs exist but are not being applied (for debugging)
          if (isEntrypointRef && !isEntrypointComponent) {
            console.warn(
              `[Workflow] Node '${action.ref}' matches entrypoint ref but is not an entrypoint component (${action.componentId}). Inputs skipped.`
            );
          }
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

        const output = await runComponentActivity(activityInput);
        results.set(action.ref, output.output);
      },
    });

    // Check if any component returned a failure status
    const outputs = Object.fromEntries(results);
    const failedComponents: Array<{ ref: string; error: string }> = [];

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

      throw ApplicationFailure.nonRetryable(
        errorMessage,
        'ComponentFailure',
        [{ outputs, failedComponents }],
      );
    }

    return {
      outputs,
      success: true,
    };
  } catch (error) {
    const outputs = Object.fromEntries(results);
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));

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
  nodeOverrides?: Record<string, Record<string, unknown>>;
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
