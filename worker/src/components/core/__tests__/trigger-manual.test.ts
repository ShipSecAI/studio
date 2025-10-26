import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { ManualTriggerInput, ManualTriggerOutput } from '../trigger-manual';

describe('trigger-manual component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get<ManualTriggerInput, ManualTriggerOutput>('core.trigger.manual');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Manual Trigger');
    expect(component!.category).toBe('trigger');
  });

  it('should map runtime inputs to outputs', async () => {
    const component = componentRegistry.get<ManualTriggerInput, ManualTriggerOutput>('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({
      runtimeInputs: [
        { id: 'user', label: 'User', type: 'text', required: true },
        { id: 'action', label: 'Action', type: 'text', required: true },
        { id: 'metadata', label: 'Metadata', type: 'json', required: false },
      ],
      __runtimeData: {
        user: 'alice',
        action: 'start',
        metadata: { source: 'unit-test' },
      },
    });

    const result = await component.execute(params, context);

    expect(result).toEqual({
      user: 'alice',
      action: 'start',
      metadata: { source: 'unit-test' },
    });
  });

  it('should normalise legacy string runtime input types', async () => {
    const component = componentRegistry.get('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({
      runtimeInputs: [
        { id: 'legacy', label: 'Legacy Text', type: 'string', required: true },
      ],
      __runtimeData: {
        legacy: 'hello',
      },
    });

    const result = await component.execute(params, context) as any;

    expect(result).toEqual({
      legacy: 'hello',
    });
  });

  it('should handle empty runtime input configuration', async () => {
    const component = componentRegistry.get<ManualTriggerInput, ManualTriggerOutput>('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({});

    const result = await component.execute(params, context);

    expect(result).toEqual({});
  });

  it('should throw when required runtime input is missing', async () => {
    const component = componentRegistry.get<ManualTriggerInput, ManualTriggerOutput>('core.trigger.manual');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'trigger-test',
    });

    const params = component.inputSchema.parse({
      runtimeInputs: [
        { id: 'user', label: 'User', type: 'text', required: true },
      ],
      __runtimeData: {},
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      "Required runtime input 'User' (user) was not provided",
    );
  });
});
