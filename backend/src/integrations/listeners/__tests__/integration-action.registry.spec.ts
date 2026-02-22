import { describe, expect, it, beforeEach } from 'bun:test';

import { IntegrationActionRegistry } from '../integration-action.registry';
import type { IntegrationAutoAction } from '../integration-action.registry';

describe('IntegrationActionRegistry', () => {
  let registry: IntegrationActionRegistry;

  beforeEach(() => {
    registry = new IntegrationActionRegistry();
  });

  function makeAction(name: string, providers: string[]): IntegrationAutoAction {
    return {
      name,
      providers,
      execute: async () => {},
    };
  }

  it('returns only actions registered for the given provider', () => {
    registry.register(makeAction('aws-sync', ['aws']));
    registry.register(makeAction('github-scan', ['github']));

    const actions = registry.getActionsForProvider('aws');
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe('aws-sync');
  });

  it('returns wildcard actions for any provider', () => {
    registry.register(makeAction('audit-log', ['*']));
    registry.register(makeAction('aws-sync', ['aws']));

    const awsActions = registry.getActionsForProvider('aws');
    expect(awsActions).toHaveLength(2);

    const githubActions = registry.getActionsForProvider('github');
    expect(githubActions).toHaveLength(1);
    expect(githubActions[0].name).toBe('audit-log');
  });

  it('returns empty array for unregistered providers', () => {
    registry.register(makeAction('aws-sync', ['aws']));

    const actions = registry.getActionsForProvider('azure');
    expect(actions).toHaveLength(0);
  });
});
