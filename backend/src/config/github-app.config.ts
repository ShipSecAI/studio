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

function normalizeGitHubAppValue(value: string | undefined): string | null {
  if (!value) return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const lowered = normalized.toLowerCase();
  if (lowered === 'disabled' || lowered === '0' || lowered === 'null') {
    return null;
  }

  return normalized;
}

export const githubAppConfig = registerAs<GitHubAppConfig>('githubApp', () => {
  // Private key can be provided as base64 or raw PEM
  let privateKey = normalizeGitHubAppValue(process.env.GITHUB_APP_PRIVATE_KEY);
  if (privateKey && !privateKey.includes('-----BEGIN')) {
    // Assume base64 encoded
    try {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    } catch {
      // Keep as-is if decoding fails
    }
  }

  return {
    appId: normalizeGitHubAppValue(process.env.GITHUB_APP_ID),
    privateKey,
    webhookSecret: normalizeGitHubAppValue(process.env.GITHUB_APP_WEBHOOK_SECRET),
    clientId: normalizeGitHubAppValue(process.env.GITHUB_APP_CLIENT_ID),
    clientSecret: normalizeGitHubAppValue(process.env.GITHUB_APP_CLIENT_SECRET),
    slug: normalizeGitHubAppValue(process.env.GITHUB_APP_SLUG),
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
  let privateKey = normalizeGitHubAppValue(process.env.GITHUB_APP_PRIVATE_KEY);
  if (privateKey && !privateKey.includes('-----BEGIN')) {
    try {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    } catch {
      // Keep as-is if decoding fails
    }
  }

  return {
    appId: normalizeGitHubAppValue(process.env.GITHUB_APP_ID),
    privateKey,
    webhookSecret: normalizeGitHubAppValue(process.env.GITHUB_APP_WEBHOOK_SECRET),
    clientId: normalizeGitHubAppValue(process.env.GITHUB_APP_CLIENT_ID),
    clientSecret: normalizeGitHubAppValue(process.env.GITHUB_APP_CLIENT_SECRET),
    slug: normalizeGitHubAppValue(process.env.GITHUB_APP_SLUG),
    apiBaseUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
    baseUrl: process.env.GITHUB_URL ?? 'https://github.com',
  };
}
