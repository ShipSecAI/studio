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
  const githubScopes =
    process.env.GITHUB_OAUTH_SCOPES?.split(',').map((scope) => scope.trim()).filter(Boolean) ??
    ['repo', 'read:user'];

  const zoomScopes =
    process.env.ZOOM_OAUTH_SCOPES?.split(',').map((scope) => scope.trim()).filter(Boolean) ??
    ['user:read:admin'];

  return {
    github: {
      id: 'github',
      name: 'GitHub',
      description: 'Connect to GitHub APIs on behalf of this user/workspace.',
      docsUrl: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps',
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      defaultScopes: githubScopes,
      scopeSeparator: ' ',
      supportsRefresh: true,
      usesPkce: false,
      tokenRequestEncoding: 'json',
      tokenAuthMethod: 'client_secret_post',
      extraAuthorizeParams: {
        allow_signup: 'false',
      },
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? null,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? null,
    },
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
