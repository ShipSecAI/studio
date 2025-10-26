import { beforeAll, describe, expect, it } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';
import type { SleepParallelInput, SleepParallelOutput } from '../sleep-parallel';

describe('test.sleep.parallel component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get<SleepParallelInput, SleepParallelOutput>('test.sleep.parallel');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Parallel Sleep (Test)');
  });

  it('should respect delay parameter and return timing metadata', async () => {
    const component = componentRegistry.get<SleepParallelInput, SleepParallelOutput>('test.sleep.parallel');
    if (!component) {
      throw new Error('test.sleep.parallel not registered');
    }

    const params = component.inputSchema.parse({
      delay: 20,
      label: 'demo',
    });

    const context = createExecutionContext({
      runId: 'sleep-test-run',
      componentRef: 'sleep-node',
    });

    const started = Date.now();
    const result = await component.execute(params, context);
    const ended = Date.now();

    expect(result.label).toBe('demo');
    expect(result.startedAt).toBeLessThanOrEqual(result.endedAt);
    expect(result.startedAt).toBeGreaterThanOrEqual(started - 5);
    expect(result.endedAt).toBeLessThanOrEqual(ended + 5);

    const elapsed = result.endedAt - result.startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(200);
  });
});
