import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { TerminalDemoInputZod, TerminalDemoOutputZod } from '../terminal-demo';

describe('terminal demo component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers in the component registry', () => {
    const component = componentRegistry.get<TerminalDemoInputZod, TerminalDemoOutputZod>(
      'shipsec.security.terminal-demo',
    );
    expect(component).toBeDefined();
    expect(component?.label).toBe('Terminal Stream Demo');
  });

  it('invokes the docker runner to emit PTY-friendly output', async () => {
    const component = componentRegistry.get<TerminalDemoInputZod, TerminalDemoOutputZod>(
      'shipsec.security.terminal-demo',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'demo-run',
      componentRef: 'terminal-demo',
    });

    const executePayload = {
      inputs: {},
      params: {
        message: 'Test message',
        durationSeconds: 5,
      },
    };

    const mockOutput = 'Demo completed successfully';

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(mockOutput);

    const result = component.outputs.parse(await component.execute(executePayload, context));

    expect(spy).toHaveBeenCalled();
    expect(result.message).toBe('Test message');
    expect(result.durationSeconds).toBe(5);
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(0);
    expect(result.rawOutput).toBeTruthy();
  });
});
