import { proxyActivities } from '@temporalio/workflow';
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
  setRunMetadataActivity(input: { runId: string; workflowId: string }): Promise<void>;
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

  await setRunMetadataActivity({ runId: input.runId, workflowId: input.workflowId });

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
          if (action.componentId === 'core.trigger.manual') {
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

    return {
      outputs: Object.fromEntries(results),
      success: true,
    };
  } catch (error) {
    return {
      outputs: Object.fromEntries(results),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await finalizeRunActivity({ runId: input.runId }).catch((err) => {
      console.error(`[Workflow] Failed to finalize run ${input.runId}`, err);
    });
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
