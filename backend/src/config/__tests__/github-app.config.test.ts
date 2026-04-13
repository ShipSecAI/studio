import { afterEach, describe, expect, it } from 'bun:test';
import { getGitHubAppConfig, isGitHubAppConfigured } from '../github-app.config';

const ORIGINAL_ENV = { ...process.env };

describe('githubAppConfig', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('treats placeholder disabled values as missing', () => {
    process.env.GITHUB_APP_ID = '0';
    process.env.GITHUB_APP_SLUG = 'disabled';
    process.env.GITHUB_APP_CLIENT_ID = 'disabled';
    process.env.GITHUB_APP_CLIENT_SECRET = 'disabled';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'disabled';
    process.env.GITHUB_APP_PRIVATE_KEY = 'disabled';

    const config = getGitHubAppConfig();

    expect(config.appId).toBeNull();
    expect(config.slug).toBeNull();
    expect(config.clientId).toBeNull();
    expect(config.clientSecret).toBeNull();
    expect(config.webhookSecret).toBeNull();
    expect(config.privateKey).toBeNull();
    expect(isGitHubAppConfigured(config)).toBe(false);
  });

  it('keeps real values intact', () => {
    process.env.GITHUB_APP_ID = '3002802';
    process.env.GITHUB_APP_SLUG = 'shipsec-app';
    process.env.GITHUB_APP_CLIENT_ID = 'client-id';
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    ).toString('base64');

    const config = getGitHubAppConfig();

    expect(config.appId).toBe('3002802');
    expect(config.slug).toBe('shipsec-app');
    expect(config.clientId).toBe('client-id');
    expect(config.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(isGitHubAppConfigured(config)).toBe(true);
  });
});
