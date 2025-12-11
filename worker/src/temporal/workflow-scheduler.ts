import type { WorkflowDefinition, WorkflowJoinStrategy } from './types';

export class WorkflowSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowSchedulerError';
  }
}

export interface SchedulerFailureDetails {
  message: string;
  name?: string;
}

export interface WorkflowSchedulerRunContext {
  joinStrategy: WorkflowJoinStrategy | 'all';
  triggeredBy?: string;
  failure?: {
    at: string;
    reason: SchedulerFailureDetails;
  };
}

export interface WorkflowSchedulerOptions {
  run: (actionRef: string, context: WorkflowSchedulerRunContext) => Promise<void>;
}

interface NodeState {
  strategy: WorkflowJoinStrategy | 'all';
  successParents: Set<string>;
  failureParents: Set<string>;
  triggeredBySuccess: boolean;
  failureTriggered: boolean;
}

interface ReadyItem {
  ref: string;
  context: WorkflowSchedulerRunContext;
}

export async function runWorkflowWithScheduler(
  definition: WorkflowDefinition,
  options: WorkflowSchedulerOptions,
): Promise<void> {
  const { run } = options;

  const successDependents = new Map<string, string[]>();
  const failureDependents = new Map<string, string[]>();
  const successParentsMap = new Map<string, Set<string>>();
  const failureParentsMap = new Map<string, Set<string>>();

  for (const edge of definition.edges ?? []) {
    if (edge.kind === 'error') {
      const children = failureDependents.get(edge.sourceRef) ?? [];
      children.push(edge.targetRef);
      failureDependents.set(edge.sourceRef, children);

      const parents = failureParentsMap.get(edge.targetRef) ?? new Set<string>();
      parents.add(edge.sourceRef);
      failureParentsMap.set(edge.targetRef, parents);
    } else {
      const children = successDependents.get(edge.sourceRef) ?? [];
      children.push(edge.targetRef);
      successDependents.set(edge.sourceRef, children);

      const parents = successParentsMap.get(edge.targetRef) ?? new Set<string>();
      parents.add(edge.sourceRef);
      successParentsMap.set(edge.targetRef, parents);
    }
  }

  const nodeStates = new Map<string, NodeState>();
  const readyQueue: ReadyItem[] = [];
  const pending = new Set<string>();

  for (const action of definition.actions) {
    pending.add(action.ref);

    const successParents = new Set(successParentsMap.get(action.ref) ?? []);
    const failureParents = new Set(failureParentsMap.get(action.ref) ?? []);

    const metadata = definition.nodes?.[action.ref];
    const strategy: WorkflowJoinStrategy | 'all' = metadata?.joinStrategy ?? 'all';

    const state: NodeState = {
      strategy,
      successParents,
      failureParents,
      triggeredBySuccess: successParents.size === 0,
      failureTriggered: false,
    };

    nodeStates.set(action.ref, state);

    if (successParents.size === 0 && failureParents.size === 0) {
      // Prioritize entrypoint to run first if it has no dependencies
      const isEntrypoint = action.ref === definition.entrypoint.ref;
      if (isEntrypoint) {
        readyQueue.unshift({ ref: action.ref, context: { joinStrategy: strategy } });
      } else {
        readyQueue.push({ ref: action.ref, context: { joinStrategy: strategy } });
      }
    }
  }

  const failedErrors = new Map<string, unknown>();

  while (pending.size > 0) {
    if (readyQueue.length === 0) {
      throw new WorkflowSchedulerError(
        'Workflow scheduler deadlock: no ready actions while workflow still incomplete',
      );
    }

    // Sort ready queue to ensure entrypoint runs first if present
    readyQueue.sort((a, b) => {
      const aIsEntrypoint = a.ref === definition.entrypoint.ref;
      const bIsEntrypoint = b.ref === definition.entrypoint.ref;
      if (aIsEntrypoint && !bIsEntrypoint) return -1;
      if (!aIsEntrypoint && bIsEntrypoint) return 1;
      return 0;
    });

    const batch = readyQueue.splice(0);
    const executions: Array<{ ref: string; context: WorkflowSchedulerRunContext }> = [];

    for (const item of batch) {
      if (!pending.has(item.ref)) {
        continue;
      }
      pending.delete(item.ref);
      executions.push(item);
    }

    if (executions.length === 0) {
      continue;
    }

    const settled = await Promise.all(
      executions.map(({ ref, context }) =>
        run(ref, context)
          .then(() => ({
            ref,
            context,
            status: 'fulfilled' as const,
            completedAt: Date.now(),
          }))
          .catch((reason) => ({
            ref,
            context,
            status: 'rejected' as const,
            reason,
            completedAt: Date.now(),
          })),
      ),
    );

    settled.sort((a, b) => a.completedAt - b.completedAt);

    for (const outcome of settled) {
      const { ref, context } = outcome;

      if (outcome.status === 'fulfilled') {
        handleSuccess(ref, readyQueue, pending, nodeStates, successDependents);
      } else {
        failedErrors.set(ref, outcome.reason);
        handleFailure(
          ref,
          context.triggeredBy ?? ref,
          readyQueue,
          pending,
          nodeStates,
          successDependents,
          failureDependents,
          failedErrors,
        );
      }
    }
  }

  if (failedErrors.size > 0) {
    const aggregate = new WorkflowSchedulerError('One or more workflow actions failed');
    (aggregate as any).causes = failedErrors;
    throw aggregate;
  }
}

function handleSuccess(
  ref: string,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successDependents: Map<string, string[]>,
) {
  const children = successDependents.get(ref) ?? [];
  for (const child of children) {
    if (!pending.has(child)) {
      continue;
    }

    const state = nodeStates.get(child);
    if (!state || state.failureTriggered) {
      continue;
    }

    state.successParents.delete(ref);

    if (state.strategy === 'all') {
      if (!state.triggeredBySuccess && state.successParents.size === 0) {
        state.triggeredBySuccess = true;
        readyQueue.push({ ref: child, context: { joinStrategy: state.strategy } });
      }
    } else if (!state.triggeredBySuccess) {
      state.triggeredBySuccess = true;
      readyQueue.push({
        ref: child,
        context: { joinStrategy: state.strategy, triggeredBy: ref },
      });
    }
  }
}

function handleFailure(
  ref: string,
  triggerSource: string,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successDependents: Map<string, string[]>,
  failureDependents: Map<string, string[]>,
  failedErrors: Map<string, unknown>,
) {
  const queue: Array<{ ref: string; source: string }> = [{ ref, source: triggerSource }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { ref: current, source } = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const state = nodeStates.get(current);
    if (state) {
      state.failureTriggered = true;
    }

    // Schedule failure dependents (error edges)
    const failureChildren = failureDependents.get(current) ?? [];
    const failureReason = normalizeFailureReason(failedErrors.get(current));
    for (const child of failureChildren) {
      const childState = nodeStates.get(child);
      if (!childState || childState.failureTriggered) {
        continue;
      }
      childState.failureTriggered = true;
      readyQueue.push({
        ref: child,
        context: {
          joinStrategy: childState.strategy,
          triggeredBy: current,
          failure: failureReason
            ? {
                at: current,
                reason: failureReason,
              }
            : undefined,
        },
      });
    }

    // Cancel success dependents and propagate failure downstream
    const successChildren = successDependents.get(current) ?? [];
    for (const child of successChildren) {
      const childState = nodeStates.get(child);
      if (!childState || childState.failureTriggered) {
        continue;
      }

      childState.successParents.delete(current);

      if (!pending.has(child)) {
        continue;
      }

      const remainingParents = childState.successParents.size;
      const shouldCancel =
        childState.strategy === 'all' ||
        (remainingParents === 0 && !childState.triggeredBySuccess);

      if (!shouldCancel) {
        continue;
      }

      pending.delete(child);
      childState.failureTriggered = true;
      failedErrors.set(
        child,
        new WorkflowSchedulerError(`Cancelled due to upstream failure at ${current}`),
      );
      queue.push({ ref: child, source: current });
    }
  }
}

function normalizeFailureReason(reason: unknown): SchedulerFailureDetails | undefined {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      name: reason.name && reason.name !== 'Error' ? reason.name : undefined,
    };
  }

  if (reason === undefined || reason === null) {
    return { message: 'Unknown failure' };
  }

  if (typeof reason === 'string') {
    return { message: reason };
  }

  if (typeof reason === 'object') {
    try {
      return { message: JSON.stringify(reason) };
    } catch {
      return { message: String(reason) };
    }
  }

  return { message: String(reason) };
}
