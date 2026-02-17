import { registerAs } from '@nestjs/config';

export interface GitHubAppConfig {
  appId: string | null;
  privateKey: string | null;
  webhookSecret: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /** App slug for install URL (e.g. "shipsec-test") */
  slug: string | null;
  /** Base URL for GitHub API (default: https://api.github.com) */
  apiBaseUrl: string;
  /** Base URL for GitHub (default: https://github.com) */
  baseUrl: string;
}

export const githubAppConfig = registerAs<GitHubAppConfig>('githubApp', () => {
  // Private key can be provided as base64 or raw PEM
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? null;
  if (privateKey && !privateKey.includes('-----BEGIN')) {
    // Assume base64 encoded
    try {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    } catch {
      // Keep as-is if decoding fails
    }
  }

  return {
    appId: process.env.GITHUB_APP_ID ?? null,
    privateKey,
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? null,
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? null,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? null,
    slug: process.env.GITHUB_APP_SLUG ?? null,
    apiBaseUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    baseUrl: process.env.GITHUB_URL ?? 'https://github.com',
  };
});

export function isGitHubAppConfigured(config: GitHubAppConfig): boolean {
  return Boolean(config.appId && config.privateKey);
}

/**
 * Get the GitHub App configuration from environment variables.
 * This is useful for accessing the config outside of the NestJS DI context.
 * For use within NestJS modules, prefer injecting ConfigService and using
 * configService.get<GitHubAppConfig>('githubApp').
 */
export function getGitHubAppConfig(): GitHubAppConfig {
  let privateKey = process.env.GITHUB_APP_PRIVATE_KEY ?? null;
  if (privateKey && !privateKey.includes('-----BEGIN')) {
    try {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    } catch {
      // Keep as-is if decoding fails
    }
  }

  return {
    appId: process.env.GITHUB_APP_ID ?? null,
    privateKey,
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? null,
    clientId: process.env.GITHUB_APP_CLIENT_ID ?? null,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? null,
    slug: process.env.GITHUB_APP_SLUG ?? null,
    apiBaseUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    baseUrl: process.env.GITHUB_URL ?? 'https://github.com',
  };
}
