import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../index';

describe('trigger-manual component', () => {
  beforeAll(() => {
    require('../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get('core.trigger.manual');
    expect(component).toBeDefined();
    expect(component?.label).toBe('Manual Trigger');
    expect(component?.category).toBe('trigger');
  });

  it('should pass through payload', async () => {
    const component = componentRegistry.get('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({
      payload: {
        user: 'alice',
        action: 'start',
        timestamp: Date.now(),
      },
    });

    const result = await component.execute(params, context) as any;

    expect(result.payload).toEqual({
      user: 'alice',
      action: 'start',
      timestamp: (params as any).payload.timestamp,
    });
  });

  it('should handle empty payload', async () => {
    const component = componentRegistry.get('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({});

    const result = await component.execute(params, context) as any;

    expect(result.payload).toEqual({});
  });
});

