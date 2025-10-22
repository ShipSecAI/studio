import { beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  type ComponentDefinition,
  type ExecutionContext,
  type TraceEvent,
} from '@shipsec/component-sdk';

import { executeWorkflow } from '../workflow-runner';
import type { WorkflowDefinition, WorkflowLogEntry, WorkflowLogSink } from '../types';

// Ensure built-in components are registered for workflow execution
import '../../components';

describe('executeWorkflow', () => {
  beforeAll(() => {
    if (!componentRegistry.has('test.echo')) {
      const component: ComponentDefinition<{ value: string }, { echoed: string }> = {
        id: 'test.echo',
        label: 'Test Echo',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ echoed: z.string() }),
        async execute(params, context) {
          context.emitProgress({ message: `Echoing ${params.value}`, level: 'debug' });
          return { echoed: params.value };
        },
      };

      componentRegistry.register(component);
    }
  });

  it('records trace events with explicit levels in order of execution', async () => {
    const events: TraceEvent[] = [];
    const trace = {
      record: (event: TraceEvent) => {
        events.push(event);
      },
    };

    const logEntries: WorkflowLogEntry[] = [];
    const logs: WorkflowLogSink = {
      append: async (entry) => {
        logEntries.push(entry);
      },
    };

    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Trace Ordering',
      description: 'Validate trace ordering and levels',
      entrypoint: { ref: 'node-1' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        'node-1': { ref: 'node-1', streamId: 'stream-node-1', joinStrategy: 'all' },
        'node-2': { ref: 'node-2', streamId: 'stream-node-2', joinStrategy: 'any' },
      },
      edges: [
        {
          id: 'node-1->node-2',
          sourceRef: 'node-1',
          targetRef: 'node-2',
          kind: 'success',
        },
      ],
      dependencyCounts: {
        'node-1': 0,
        'node-2': 1,
      },
      actions: [
        {
          ref: 'node-1',
          componentId: 'test.echo',
          params: { value: 'first' },
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'node-2',
          componentId: 'core.console.log',
          params: { data: 'second' },
          dependsOn: ['node-1'],
          inputMappings: {
            label: {
              sourceRef: 'node-1',
              sourceHandle: 'echoed',
            },
          },
        },
      ],
    };

    const result = await executeWorkflow(definition, {}, {
      runId: 'trace-run',
      trace,
      logs,
    });

    expect(result.success).toBe(true);
    await Promise.resolve();

    const logEvents = events.filter((event) => (event.data as any)?.origin === 'log');
    const executionEvents = events.filter((event) => (event.data as any)?.origin !== 'log');

    expect(executionEvents).toHaveLength(6);
    expect(executionEvents.map((event) => event.type)).toEqual([
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
    ]);

    const startedEvents = executionEvents.filter((event) => event.type === 'NODE_STARTED');
    startedEvents.forEach((event) => {
      expect(event.level).toBe('info');
      if (event.nodeRef === 'node-1') {
        expect(event.context).toMatchObject({
          streamId: 'stream-node-1',
          joinStrategy: 'all',
        });
      } else if (event.nodeRef === 'node-2') {
        expect(event.context).toMatchObject({
          streamId: 'stream-node-2',
          joinStrategy: 'any',
        });
      }
    });

    expect(logEntries.length).toBeGreaterThan(0);
    expect(logEvents.length).toBe(logEntries.length);
    expect(logEntries.some((entry) => entry.message.includes('[first]'))).toBe(true);
  });
  it('executes independent branches in parallel', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Parallel branches',
      description: 'Two branches should execute concurrently',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start', streamId: 'stream-start', joinStrategy: 'all' },
        branchA: { ref: 'branchA', streamId: 'stream-branchA', joinStrategy: 'all' },
        branchB: { ref: 'branchB', streamId: 'stream-branchB', joinStrategy: 'all' },
        merge: { ref: 'merge', streamId: 'stream-merge', joinStrategy: 'all' },
      },
      edges: [
        { id: 'start->branchA', sourceRef: 'start', targetRef: 'branchA', kind: 'success' as const },
        { id: 'start->branchB', sourceRef: 'start', targetRef: 'branchB', kind: 'success' as const },
        { id: 'branchA->merge', sourceRef: 'branchA', targetRef: 'merge', kind: 'success' as const },
        { id: 'branchB->merge', sourceRef: 'branchB', targetRef: 'merge', kind: 'success' as const },
      ],
      dependencyCounts: {
        start: 0,
        branchA: 1,
        branchB: 1,
        merge: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'test.sleep.parallel',
          params: { delay: 50, label: 'start' },
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'branchA',
          componentId: 'test.sleep.parallel',
          params: { delay: 200, label: 'branchA' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'branchB',
          componentId: 'test.sleep.parallel',
          params: { delay: 200, label: 'branchB' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'test.sleep.parallel',
          params: { delay: 0, label: 'merge' },
          dependsOn: ['branchA', 'branchB'],
          inputMappings: {},
        },
      ],
    };

    const result = await executeWorkflow(definition);
    expect(result.success).toBe(true);

    const outputs = result.outputs as Record<
      string,
      { startedAt: number; endedAt: number; label: string }
    >;

    const start = outputs.start;
    const branchA = outputs.branchA;
    const branchB = outputs.branchB;
    const merge = outputs.merge;

    expect(start).toBeDefined();
    expect(branchA).toBeDefined();
    expect(branchB).toBeDefined();
    expect(merge).toBeDefined();

    const branchStartDelta = Math.abs(branchA.startedAt - branchB.startedAt);
    expect(branchStartDelta).toBeLessThan(75);

    const branchAElapsed = branchA.endedAt - branchA.startedAt;
    const branchBElapsed = branchB.endedAt - branchB.startedAt;
    expect(branchAElapsed).toBeGreaterThanOrEqual(190);
    expect(branchBElapsed).toBeGreaterThanOrEqual(190);

    const totalElapsed = merge.endedAt - start.startedAt;
    expect(totalElapsed).toBeLessThan(350);
  });

  it('produces a deterministic trace sequence across repeated runs', async () => {
    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Deterministic Trace',
      description: 'Parallel branches should yield the same trace ordering on every run',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start', streamId: 'trace-start', joinStrategy: 'all' },
        branchLeft: { ref: 'branchLeft', streamId: 'trace-left', joinStrategy: 'all' },
        branchRight: { ref: 'branchRight', streamId: 'trace-right', joinStrategy: 'all' },
        merge: { ref: 'merge', streamId: 'trace-merge', joinStrategy: 'all' },
      },
      edges: [
        { id: 'start->branchLeft', sourceRef: 'start', targetRef: 'branchLeft', kind: 'success' as const },
        { id: 'start->branchRight', sourceRef: 'start', targetRef: 'branchRight', kind: 'success' as const },
        { id: 'branchLeft->merge', sourceRef: 'branchLeft', targetRef: 'merge', kind: 'success' as const },
        { id: 'branchRight->merge', sourceRef: 'branchRight', targetRef: 'merge', kind: 'success' as const },
      ],
      dependencyCounts: {
        start: 0,
        branchLeft: 1,
        branchRight: 1,
        merge: 2,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'core.trigger.manual',
          params: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'branchLeft',
          componentId: 'test.sleep.parallel',
          params: { delay: 40, label: 'left' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'branchRight',
          componentId: 'test.sleep.parallel',
          params: { delay: 20, label: 'right' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'core.console.log',
          params: { data: 'merge-complete' },
          dependsOn: ['branchLeft', 'branchRight'],
          inputMappings: {},
        },
      ],
    };

    const normalizeEvent = (event: TraceEvent) => ({
      type: event.type,
      nodeRef: event.nodeRef,
      level: event.level,
      context: event.context
        ? {
            streamId: event.context.streamId,
            joinStrategy: event.context.joinStrategy,
            triggeredBy: event.context.triggeredBy,
            failure: event.context.failure,
          }
        : undefined,
    });

    const runWithTrace = async (runId: string) => {
      const events: TraceEvent[] = [];
      const trace = {
        record: (event: TraceEvent) => {
          events.push(event);
        },
      };

      const result = await executeWorkflow(
        definition,
        {},
        {
          runId,
          trace,
        },
      );

      expect(result.success).toBe(true);
      return events.map(normalizeEvent);
    };

    const firstSequence = await runWithTrace('determinism-run-1');
    const secondSequence = await runWithTrace('determinism-run-2');

    expect(secondSequence).toEqual(firstSequence);
  });

  it('triggers downstream when join strategy is any', async () => {
    if (!componentRegistry.has('test.trigger.capture')) {
      const captureComponent: ComponentDefinition<{ label: string }, { triggeredBy?: string }> = {
        id: 'test.trigger.capture',
        label: 'Capture Trigger',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ label: z.string() }),
        outputSchema: z.object({ triggeredBy: z.string().optional() }),
        async execute(params, context) {
          const triggeredBy = context.metadata.triggeredBy;
          return triggeredBy ? { triggeredBy } : {};
        },
      };

      componentRegistry.register(captureComponent);
    }

    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Join Any',
      description: 'Merge should run after the first branch completes',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start' },
        branchSlow: { ref: 'branchSlow' },
        branchFast: { ref: 'branchFast' },
        merge: { ref: 'merge', joinStrategy: 'any' },
      },
      edges: [
        { id: 'start->branchSlow', sourceRef: 'start', targetRef: 'branchSlow', kind: 'success' as const },
        { id: 'start->branchFast', sourceRef: 'start', targetRef: 'branchFast', kind: 'success' as const },
        { id: 'branchSlow->merge', sourceRef: 'branchSlow', targetRef: 'merge', kind: 'success' as const },
        { id: 'branchFast->merge', sourceRef: 'branchFast', targetRef: 'merge', kind: 'success' as const },
      ],
      dependencyCounts: {
        start: 0,
        branchSlow: 1,
        branchFast: 1,
        merge: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'core.trigger.manual',
          params: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'branchSlow',
          componentId: 'test.sleep.parallel',
          params: { delay: 200, label: 'slow' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'branchFast',
          componentId: 'test.sleep.parallel',
          params: { delay: 10, label: 'fast' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'merge',
          componentId: 'test.trigger.capture',
          params: { label: 'merge' },
          dependsOn: ['branchSlow', 'branchFast'],
          inputMappings: {},
        },
      ],
    };

    const result = await executeWorkflow(definition);
    expect(result.success).toBe(true);
    const outputs = result.outputs as Record<string, any>;
    expect(outputs.merge.triggeredBy).toBe('branchFast');
  });

  it('fails deterministically when an input mapping is missing', async () => {
    const events: TraceEvent[] = [];
    const trace = {
      record: (event: TraceEvent) => {
        events.push(event);
      },
    };

    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Missing input failure',
      description: 'Workflow should fail when required mappings are absent',
      entrypoint: { ref: 'node-1' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        'node-1': { ref: 'node-1' },
        'node-2': { ref: 'node-2' },
      },
      edges: [
        {
          id: 'node-1->node-2',
          sourceRef: 'node-1',
          targetRef: 'node-2',
          kind: 'success' as const,
        },
      ],
      dependencyCounts: {
        'node-1': 0,
        'node-2': 1,
      },
      actions: [
        {
          ref: 'node-1',
          componentId: 'test.echo',
          params: { value: 'first' },
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'node-2',
          componentId: 'core.console.log',
          params: { data: 'second' },
          dependsOn: ['node-1'],
          inputMappings: {
            label: {
              sourceRef: 'node-1',
              sourceHandle: 'missing-handle',
            },
          },
        },
      ],
    };

    const result = await executeWorkflow(definition, {}, { runId: 'missing-input', trace });

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more workflow actions failed');

    const warnEvent = events.find((event) => event.type === 'NODE_PROGRESS' && event.level === 'warn');
    expect(warnEvent).toBeDefined();
    expect(warnEvent?.message).toContain("Input 'label'");
  });

  it('routes failure edges when an action throws', async () => {
    const executionOrder: string[] = [];

    if (!componentRegistry.has('test.fail.always')) {
      const failComponent: ComponentDefinition<{ message: string }, never> = {
        id: 'test.fail.always',
        label: 'Always Fail',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ message: z.string() }),
        outputSchema: z.never(),
        async execute(params) {
          throw new Error(params.message);
        },
      };
      componentRegistry.register(failComponent);
    }

    if (!componentRegistry.has('test.record.execution')) {
      const recordComponent: ComponentDefinition<{ label: string }, { label: string }> = {
        id: 'test.record.execution',
        label: 'Record Execution',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ label: z.string() }),
        outputSchema: z.object({ label: z.string() }),
        async execute(params, context) {
          executionOrder.push(context.componentRef);
          return { label: params.label };
        },
      };
      componentRegistry.register(recordComponent);
    }

    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Failure edges',
      description: 'Error edge should execute when parent fails',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' as const },
        { id: 'fail->error', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' as const },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        errorHandler: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'core.trigger.manual',
          params: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'test.fail.always',
          params: { message: 'boom' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'test.record.execution',
          params: { label: 'handled' },
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
    };

    const result = await executeWorkflow(definition);
    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more workflow actions failed');
    expect(executionOrder).toEqual(['errorHandler']);
  });

  it('injects failure metadata into error-edge components', async () => {
    if (!componentRegistry.has('test.fail.always')) {
      const failComponent: ComponentDefinition<{ message: string }, never> = {
        id: 'test.fail.always',
        label: 'Always Fail',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ message: z.string() }),
        outputSchema: z.never(),
        async execute(params) {
          throw new Error(params.message);
        },
      };
      componentRegistry.register(failComponent);
    }

    const failureMetadata: Array<ExecutionContext['metadata']['failure']> = [];

    if (!componentRegistry.has('test.capture.failure-metadata')) {
      const captureComponent: ComponentDefinition<{ label: string }, { label: string }> = {
        id: 'test.capture.failure-metadata',
        label: 'Capture Failure Metadata',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({ label: z.string() }),
        outputSchema: z.object({ label: z.string() }),
        async execute(params, context) {
          failureMetadata.push(context.metadata.failure);
          return { label: params.label };
        },
      };
      componentRegistry.register(captureComponent);
    }

    const definition: WorkflowDefinition = {
      version: 1,
      title: 'Failure metadata propagation',
      entrypoint: { ref: 'start' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
      },
      nodes: {
        start: { ref: 'start' },
        fail: { ref: 'fail' },
        errorHandler: { ref: 'errorHandler' },
      },
      edges: [
        { id: 'start->fail', sourceRef: 'start', targetRef: 'fail', kind: 'success' as const },
        { id: 'fail->error', sourceRef: 'fail', targetRef: 'errorHandler', kind: 'error' as const },
      ],
      dependencyCounts: {
        start: 0,
        fail: 1,
        errorHandler: 1,
      },
      actions: [
        {
          ref: 'start',
          componentId: 'core.trigger.manual',
          params: {},
          dependsOn: [],
          inputMappings: {},
        },
        {
          ref: 'fail',
          componentId: 'test.fail.always',
          params: { message: 'boom' },
          dependsOn: ['start'],
          inputMappings: {},
        },
        {
          ref: 'errorHandler',
          componentId: 'test.capture.failure-metadata',
          params: { label: 'handled' },
          dependsOn: ['fail'],
          inputMappings: {},
        },
      ],
    };

    const result = await executeWorkflow(definition);

    expect(result.success).toBe(false);
    expect(failureMetadata).toHaveLength(1);
    expect(failureMetadata[0]).toBeDefined();
    expect(failureMetadata[0]?.at).toBe('fail');
    expect(failureMetadata[0]?.reason.message).toBe('boom');
  });
});
