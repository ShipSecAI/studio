import { randomUUID } from 'crypto';

export type TokenRequestEncoding = 'json' | 'form';
export type TokenAuthMethod = 'client_secret_post' | 'client_secret_basic';

export interface IntegrationProviderConfig {
  id: string;
  name: string;
  description: string;
  authorizeUrl: string;
  tokenUrl: string;
  docsUrl?: string;
  defaultScopes: string[];
  scopeSeparator: string;
  supportsRefresh: boolean;
  usesPkce?: boolean;
  tokenRequestEncoding: TokenRequestEncoding;
  tokenAuthMethod: TokenAuthMethod;
  extraAuthorizeParams?: Record<string, string>;
  extraTokenParams?: Record<string, string>;
  clientId?: string | null;
  clientSecret?: string | null;
}

export interface IntegrationProviderSummary {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  defaultScopes: string[];
  supportsRefresh: boolean;
  isConfigured: boolean;
}

export function loadIntegrationProviders(): Record<string, IntegrationProviderConfig> {
  const zoomScopes = process.env.ZOOM_OAUTH_SCOPES?.split(',')
    .map((scope) => scope.trim())
    .filter(Boolean) ?? ['user:read:admin'];

  const slackScopes = process.env.SLACK_OAUTH_SCOPES?.split(',')
    .map((scope) => scope.trim())
    .filter(Boolean) ?? [
    'channels:read',
    'channels:history',
    'chat:write',
    'chat:write.public',
    'commands',
    'app_mentions:read',
    'team:read',
  ];

  const jiraScopes = process.env.JIRA_OAUTH_SCOPES?.split(',')
    .map((scope) => scope.trim())
    .filter(Boolean) ?? ['read:jira-user', 'read:jira-work', 'write:jira-work', 'offline_access'];

  return {
    zoom: {
      id: 'zoom',
      name: 'Zoom',
      description: 'Automate meetings, recordings, and analytics via the Zoom APIs.',
      docsUrl: 'https://developers.zoom.us/docs/integrations/oauth/',
      authorizeUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      defaultScopes: zoomScopes,
      scopeSeparator: ' ',
      supportsRefresh: true,
      usesPkce: true,
      tokenRequestEncoding: 'form',
      tokenAuthMethod: 'client_secret_basic',
      extraAuthorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      clientId: process.env.ZOOM_OAUTH_CLIENT_ID ?? null,
      clientSecret: process.env.ZOOM_OAUTH_CLIENT_SECRET ?? null,
    },
    slack: {
      id: 'slack',
      name: 'Slack',
      description: 'Send messages and alerts to Slack channels via the Slack API.',
      docsUrl: 'https://api.slack.com/authentication/oauth-v2',
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      defaultScopes: slackScopes,
      scopeSeparator: ',',
      supportsRefresh: false,
      usesPkce: false,
      tokenRequestEncoding: 'form',
      tokenAuthMethod: 'client_secret_post',
      clientId: process.env.SLACK_OAUTH_CLIENT_ID ?? null,
      clientSecret: process.env.SLACK_OAUTH_CLIENT_SECRET ?? null,
    },
    jira: {
      id: 'jira',
      name: 'Jira',
      description: 'Create and manage Jira issues through Atlassian OAuth.',
      docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
      authorizeUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      defaultScopes: jiraScopes,
      scopeSeparator: ' ',
      supportsRefresh: true,
      usesPkce: false,
      tokenRequestEncoding: 'json',
      tokenAuthMethod: 'client_secret_post',
      extraAuthorizeParams: {
        audience: 'api.atlassian.com',
        prompt: 'consent',
      },
      clientId: process.env.JIRA_OAUTH_CLIENT_ID ?? null,
      clientSecret: process.env.JIRA_OAUTH_CLIENT_SECRET ?? null,
    },
  };
}

export function summarizeProvider(config: IntegrationProviderConfig): IntegrationProviderSummary {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    docsUrl: config.docsUrl,
    defaultScopes: config.defaultScopes,
    supportsRefresh: config.supportsRefresh,
    isConfigured: Boolean(config.clientId && config.clientSecret),
  };
}

export function generateState(): string {
  return randomUUID();
}
