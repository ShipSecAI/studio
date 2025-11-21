import { registerAs } from '@nestjs/config';

export interface GithubAppConfig {
  appId: number | null;
  privateKey: string | null;
  webhookSecret: string | null;
}

function parseAppId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export const githubAppConfig = registerAs<GithubAppConfig>('githubApp', () => ({
  appId: parseAppId(process.env.GITHUB_APP_ID),
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? null,
  webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? null,
}));
