import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { TerminalDemoInput, TerminalDemoOutput } from '../terminal-demo';

describe('terminal demo component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers in the component registry', () => {
    const component = componentRegistry.get<TerminalDemoInput, TerminalDemoOutput>(
      'shipsec.security.terminal-demo',
    );
    expect(component).toBeDefined();
    expect(component?.label).toBe('Terminal Stream Demo');
  });

  it('invokes the docker runner to emit PTY-friendly output', async () => {
    const component = componentRegistry.get<TerminalDemoInput, TerminalDemoOutput>(
      'shipsec.security.terminal-demo',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'demo-run',
      componentRef: 'terminal-demo',
    });

    const params = component.inputSchema.parse({
      message: 'Testing terminal stream',
      durationSeconds: 5,
    });

    const rawOutput =
      '| Testing terminal stream [###.......] 050.0%\n[0000:00] ABCDEFGHIJKL\nTerminal demo complete.\n';
    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(rawOutput);

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(spy).toHaveBeenCalled();
    expect(result.message).toBe('Testing terminal stream');
    expect(result.durationSeconds).toBe(5);
    expect(result.rawOutput).toBe(rawOutput);
    const expectedFrames =
      Math.floor((params.durationSeconds * 1000) / params.intervalMs) * params.burstLines;
    expect(result.framesAttempted).toBe(expectedFrames);
  });
});
