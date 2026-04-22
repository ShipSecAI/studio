import { afterEach, describe, expect, it } from 'bun:test';

import { loadIntegrationProviders } from '../integration-providers';

const DEFAULT_SCOPE_KEYS = [
  'SLACK_OAUTH_SCOPES',
  'ZOOM_OAUTH_SCOPES',
  'JIRA_OAUTH_SCOPES',
] as const;

function restoreEnv(savedEnv: Record<(typeof DEFAULT_SCOPE_KEYS)[number], string | undefined>) {
  for (const key of DEFAULT_SCOPE_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      continue;
    }
    process.env[key] = value;
  }
}

describe('loadIntegrationProviders slack defaults', () => {
  const savedEnv = {
    SLACK_OAUTH_SCOPES: process.env.SLACK_OAUTH_SCOPES,
    ZOOM_OAUTH_SCOPES: process.env.ZOOM_OAUTH_SCOPES,
    JIRA_OAUTH_SCOPES: process.env.JIRA_OAUTH_SCOPES,
  };

  afterEach(() => {
    restoreEnv(savedEnv);
  });

  it('uses the thread-based Slack scope set by default', () => {
    delete process.env.SLACK_OAUTH_SCOPES;

    const providers = loadIntegrationProviders();

    expect(providers.slack.defaultScopes).toEqual([
      'channels:read',
      'channels:history',
      'chat:write',
      'chat:write.public',
      'commands',
      'app_mentions:read',
      'team:read',
    ]);
  });

  it('respects an explicit Slack scope override', () => {
    process.env.SLACK_OAUTH_SCOPES = 'chat:write,commands';

    const providers = loadIntegrationProviders();

    expect(providers.slack.defaultScopes).toEqual(['chat:write', 'commands']);
  });

  it('exposes the Jira OAuth provider with the default scope set', () => {
    delete process.env.JIRA_OAUTH_SCOPES;

    const providers = loadIntegrationProviders();

    expect(providers.jira.defaultScopes).toEqual([
      'read:jira-user',
      'read:jira-work',
      'write:jira-work',
      'offline_access',
    ]);
  });
});
