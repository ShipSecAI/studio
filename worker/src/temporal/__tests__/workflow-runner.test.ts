import { beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { componentRegistry, type ComponentDefinition, type TraceEvent } from '@shipsec/component-sdk';

import { executeWorkflow } from '../workflow-runner';
import type { WorkflowDefinition } from '../types';

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

    const definition: WorkflowDefinition = {
      title: 'Trace Ordering',
      description: 'Validate trace ordering and levels',
      entrypoint: { ref: 'node-1' },
      config: {
        environment: 'test',
        timeoutSeconds: 30,
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

    const result = await executeWorkflow(
      definition,
      {},
      {
        runId: 'trace-run',
        trace,
      },
    );

    expect(result.success).toBe(true);
    expect(events).toHaveLength(7);
    expect(events.map((event) => event.type)).toEqual([
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
      'NODE_STARTED',
      'NODE_PROGRESS',
      'NODE_PROGRESS',
      'NODE_COMPLETED',
    ]);

    const warnProgress = events[4];
    expect(warnProgress.type).toBe('NODE_PROGRESS');
    expect(warnProgress.level).toBe('warn');
    expect(warnProgress.message).toContain("Input 'label'");
    expect(warnProgress.data).toEqual({
      target: 'label',
      sourceRef: 'node-1',
      sourceHandle: 'missing',
    });

    const failureEvents = events.filter((event) => event.level === 'error');
    expect(failureEvents).toHaveLength(0);

    const startedEvents = events.filter((event) => event.type === 'NODE_STARTED');
    startedEvents.forEach((event) => {
      expect(event.level).toBe('info');
    });
  });
});
