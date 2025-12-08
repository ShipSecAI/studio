import { ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import { runWorkflowWithScheduler } from '../workflow-scheduler';
import { buildActionParams } from '../input-resolver';
import type {
  RunComponentActivityInput,
  RunComponentActivityOutput,
  RunWorkflowActivityInput,
  RunWorkflowActivityOutput,
  WorkflowAction,
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

        if (input.definition.entrypoint.ref === action.ref && input.inputs) {
          if (action.componentId === 'core.workflow.entrypoint') {
            mergedParams.__runtimeData = input.inputs;
          } else {
            Object.assign(mergedParams, input.inputs);
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
