import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rootPackage = (() => {
  try {
    return require('../../package.json');
  } catch (_) {
    return undefined;
  }
})();

const DEFAULT_BASE_URL = process.env.SHIPSEC_VERSION_CHECK_URL ?? 'https://version.shipsec.ai';
const DEFAULT_VERSION = typeof rootPackage?.version === 'string' ? rootPackage.version : '0.1.1';
const DEFAULT_TIMEOUT_MS = Number(process.env.SHIPSEC_VERSION_CHECK_TIMEOUT_MS ?? '5000');

export interface VersionCheckResponse {
  latest_version: string;
  min_supported_version: string;
  is_supported: boolean;
  should_upgrade: boolean;
  upgrade_url?: string;
}

export type VersionCheckOutcome = 'ok' | 'upgrade' | 'unsupported';

interface VersionCheckMetadata {
  version: string;
  platform?: string;
  arch?: string;
}

export interface VersionCheckResult {
  outcome: VersionCheckOutcome;
  response: VersionCheckResponse;
  requestedVersion: string;
}

export function isVersionCheckDisabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env.SHIPSEC_VERSION_CHECK_DISABLED;
  if (!value) return false;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

export async function performVersionCheck(overrides: Partial<VersionCheckMetadata> = {}): Promise<VersionCheckResult> {
  const metadata: VersionCheckMetadata = {
    version: overrides.version ?? DEFAULT_VERSION,
    platform: overrides.platform ?? process.platform,
    arch: overrides.arch ?? process.arch,
  };

  const url = new URL('/api/version/check', ensureTrailingSlash(DEFAULT_BASE_URL));
  url.searchParams.set('app', 'studio');
  url.searchParams.set('version', metadata.version);
  if (metadata.platform) url.searchParams.set('platform', metadata.platform);
  if (metadata.arch) url.searchParams.set('arch', metadata.arch);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      const body = await safeBody(response);
      throw new Error(`Version check failed with status ${response.status}${body ? `: ${body}` : ''}`);
    }
    const payload = (await response.json()) as VersionCheckResponse;
    return {
      outcome: evaluateOutcome(payload),
      response: payload,
      requestedVersion: metadata.version,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function evaluateOutcome(response: VersionCheckResponse): VersionCheckOutcome {
  if (!response.is_supported) {
    return 'unsupported';
  }
  return response.should_upgrade ? 'upgrade' : 'ok';
}

function ensureTrailingSlash(base: string) {
  return base.endsWith('/') ? base : `${base}/`;
}

async function safeBody(response: Response) {
  try {
    return await response.text();
  } catch (_) {
    return undefined;
  }
}
