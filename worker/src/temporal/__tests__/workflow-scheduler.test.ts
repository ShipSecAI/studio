import { describe, expect, it } from 'bun:test';

import { runWorkflowWithScheduler, type WorkflowSchedulerRunContext } from '../workflow-scheduler';
import type { WorkflowDefinition } from '../types';

describe('runWorkflowWithScheduler', () => {
  it('allows join-any dependents to run when at least one parent succeeds', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'join-any tolerates partial failure',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        branchFail: { ref: 'branchFail' },
        branchSuccess: { ref: 'branchSuccess' },
        merge: { ref: 'merge', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->branchFail', sourceRef: 'start', targetRef: 'branchFail', kind: 'success' },
        { id: 'start->branchSuccess', sourceRef: 'start', targetRef: 'branchSuccess', kind: 'success' },
        { id: 'branchFail->merge', sourceRef: 'branchFail', targetRef: 'merge', kind: 'success' },
        { id: 'branchSuccess->merge', sourceRef: 'branchSuccess', targetRef: 'merge', kind: 'success' },
      ],
      dependencyCounts: {
        start: 0,
        branchFail: 1,
        branchSuccess: 1,
        merge: 2,
      },
      actions: [
        { ref: 'start', componentId: 'noop', params: {}, dependsOn: [], inputMappings: {} },
        {
          ref: 'branchFail',
          componentId: 'noop',
          params: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'branchSuccess',
          componentId: 'noop',
          params: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'noop',
          params: {},
          dependsOn: ['branchFail', 'branchSuccess'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const order: string[] = [];
    let mergeTriggeredBy: string | undefined;

    const run = async (ref: string, context: WorkflowSchedulerRunContext) => {
      order.push(ref);
      if (ref === 'branchFail') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('branch failed');
      }

      if (ref === 'branchSuccess') {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      if (ref === 'merge') {
        mergeTriggeredBy = context.triggeredBy;
      }
    };

    await expect(
      runWorkflowWithScheduler(definition, {
        run,
      }),
    ).rejects.toThrow('One or more workflow actions failed');

    expect(order).toContain('merge');
    expect(mergeTriggeredBy).toBe('branchSuccess');
  });

  it('propagates failure metadata to error-edge dependents', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'error edge failure metadata',
      entrypoint: { ref: 'start' },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' },
        { id: 'fail->errorHandler', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        errorHandler: 1,
      },
      actions: [
        { ref: 'start', componentId: 'noop', params: {}, dependsOn: [], inputMappings: {} },
        {
          ref: 'fail',
          componentId: 'noop',
          params: {},
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'noop',
          params: {},
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
    };

    const contexts = new Map<string, WorkflowSchedulerRunContext>();

    const run = async (ref: string, context: WorkflowSchedulerRunContext) => {
      contexts.set(ref, context);

      if (ref === 'fail') {
        throw new Error('boom');
      }
    };

    await expect(
      runWorkflowWithScheduler(definition, {
        run,
      }),
    ).rejects.toThrow('One or more workflow actions failed');

    const failure = contexts.get('errorHandler')?.failure;
    expect(failure).toBeDefined();
    expect(failure?.at).toBe('fail');
    expect(failure?.reason.message).toBe('boom');
  });
});
