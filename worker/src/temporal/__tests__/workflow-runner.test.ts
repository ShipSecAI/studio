import { beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  type ComponentDefinition,
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
              sourceHandle: 'missing',
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

    expect(executionEvents).toHaveLength(7);
    expect(executionEvents.map((event) => event.type)).toEqual([
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
    ]);

    const warnProgress = executionEvents[4];
    expect(warnProgress.type).toBe('NODE_PROGRESS');
    expect(warnProgress.level).toBe('warn');
    expect(warnProgress.message).toContain("Input 'label'");
    expect(warnProgress.data).toEqual({
      target: 'label',
      sourceRef: 'node-1',
      sourceHandle: 'missing',
    });
    expect(warnProgress.context).toMatchObject({
      streamId: 'stream-node-2',
      joinStrategy: 'any',
    });

    const failureEvents = executionEvents.filter((event) => event.level === 'error');
    expect(failureEvents).toHaveLength(0);

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
    expect(logEntries.some((entry) => entry.message.includes('[Console Log]'))).toBe(true);
  });
  it('executes independent branches in parallel', async () => {
    const timeline: Array<{ ref: string; event: 'start' | 'end'; at: number }> = [];
    let baseTime = 0;
    const record = (ref: string, event: 'start' | 'end') => {
      timeline.push({ ref, event, at: Date.now() - baseTime });
    };

    if (!componentRegistry.has('test.sleep.parallel')) {
      const sleepComponent: ComponentDefinition<{ delay: number; label: string }, { label: string }> = {
        id: 'test.sleep.parallel',
        label: 'Parallel Sleep',
        category: 'transform',
        runner: { kind: 'inline' },
        inputSchema: z.object({
          delay: z.number(),
          label: z.string(),
        }),
        outputSchema: z.object({
          label: z.string(),
        }),
        async execute(params, context) {
          record(context.componentRef, 'start');
          await new Promise<void>((resolve) => setTimeout(resolve, params.delay));
          record(context.componentRef, 'end');
          return { label: params.label };
        },
      };

      componentRegistry.register(sleepComponent);
    }

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
      edges: [],
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

    baseTime = Date.now();
    const result = await executeWorkflow(definition);
    expect(result.success).toBe(true);

    const branchAStart = timeline.find(
      (entry) => entry.ref === 'branchA' && entry.event === 'start',
    );
    const branchBStart = timeline.find(
      (entry) => entry.ref === 'branchB' && entry.event === 'start',
    );
    const mergeEnd = timeline.find(
      (entry) => entry.ref === 'merge' && entry.event === 'end',
    );

    expect(branchAStart).toBeDefined();
    expect(branchBStart).toBeDefined();
    expect(mergeEnd).toBeDefined();

    const delta = Math.abs((branchAStart?.at ?? 0) - (branchBStart?.at ?? 0));
    expect(delta).toBeLessThan(60);

    const totalElapsed = mergeEnd?.at ?? Number.POSITIVE_INFINITY;
    expect(totalElapsed).toBeLessThan(400);
  });
});
