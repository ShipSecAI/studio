import { describe, it, expect, beforeAll, vi } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type {
  GitHubConnectionProviderInput,
  GitHubConnectionProviderOutput,
} from '../connection-provider';

describe('github.connection.provider component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('provides a trimmed connection id and emits progress', async () => {
    const component = componentRegistry.get<
      GitHubConnectionProviderInput,
      GitHubConnectionProviderOutput
    >('github.connection.provider');
    expect(component).toBeDefined();
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-connection-provider',
    });

    const progressSpy = vi.spyOn(context, 'emitProgress');

    const executePayload = {
      inputs: {},
      params: {
        connectionId: '  connection-abc  ',
      },
    };

    const result = await component.execute(executePayload, context);

    expect(result.connectionId).toBe('connection-abc');
    expect(progressSpy).toHaveBeenCalledWith('Selected GitHub connection connection-abc.');
  });

  it('validates connection id input', () => {
    const component = componentRegistry.get<
      GitHubConnectionProviderInput,
      GitHubConnectionProviderOutput
    >('github.connection.provider');
    if (!component) throw new Error('Component not registered');

    if (!component.parameters) throw new Error('Component has no parameters');

    const parsed = component.parameters.safeParse({
      connectionId: '   ',
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['connectionId']);
  });
});
