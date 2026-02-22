import { describe, expect, it, beforeEach, vi } from 'bun:test';
import { spyOn } from 'bun:test';

import { IntegrationConnectedListener } from '../integration-connected.listener';
import { IntegrationActionRegistry } from '../integration-action.registry';
import { IntegrationConnectedEvent } from '../../events/integration.events';

describe('IntegrationConnectedListener', () => {
  let listener: IntegrationConnectedListener;
  let registry: IntegrationActionRegistry;

  beforeEach(() => {
    registry = new IntegrationActionRegistry();
    listener = new IntegrationConnectedListener(registry);
  });

  function makeEvent(provider = 'aws'): IntegrationConnectedEvent {
    return new IntegrationConnectedEvent(
      'conn-123',
      provider,
      'iam_role',
      'org-1',
      'user-1',
      false,
    );
  }

  it('calls getActionsForProvider with the event provider', async () => {
    const spy = spyOn(registry, 'getActionsForProvider');
    await listener.handleIntegrationConnected(makeEvent('aws'));
    expect(spy).toHaveBeenCalledWith('aws');
  });

  it('executes all matching actions', async () => {
    const executeFn1 = vi.fn().mockResolvedValue(undefined);
    const executeFn2 = vi.fn().mockResolvedValue(undefined);

    registry.register({ name: 'action-1', providers: ['aws'], execute: executeFn1 });
    registry.register({ name: 'action-2', providers: ['aws'], execute: executeFn2 });

    await listener.handleIntegrationConnected(makeEvent());

    expect(executeFn1).toHaveBeenCalledTimes(1);
    expect(executeFn2).toHaveBeenCalledTimes(1);
  });

  it('continues executing remaining actions if one throws', async () => {
    const executeFn1 = vi.fn().mockRejectedValue(new Error('boom'));
    const executeFn2 = vi.fn().mockResolvedValue(undefined);

    registry.register({ name: 'failing', providers: ['aws'], execute: executeFn1 });
    registry.register({ name: 'succeeding', providers: ['aws'], execute: executeFn2 });

    await listener.handleIntegrationConnected(makeEvent());

    expect(executeFn1).toHaveBeenCalledTimes(1);
    expect(executeFn2).toHaveBeenCalledTimes(1);
  });

  it('does not propagate errors to the caller', async () => {
    const executeFn = vi.fn().mockRejectedValue(new Error('boom'));
    registry.register({ name: 'failing', providers: ['aws'], execute: executeFn });

    await expect(listener.handleIntegrationConnected(makeEvent())).resolves.toBeUndefined();
  });
});
