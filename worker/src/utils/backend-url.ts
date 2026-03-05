import { existsSync } from 'node:fs';

const DEFAULT_BACKEND_ORIGIN = 'http://localhost:3211';
const DEFAULT_DOCKER_BACKEND_ORIGIN = 'http://host.docker.internal:3211';

interface BackendUrlOptions {
  preferDockerHost?: boolean;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function removeApiV1Suffix(url: string): string {
  return normalizeUrl(url).replace(/\/api\/v1$/i, '');
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

function isInDocker(): boolean {
  try {
    return existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Canonical backend origin resolver for worker-to-backend calls.
 *
 * `BACKEND_URL` is the preferred env var.
 * The legacy API-base vars are still accepted for compatibility.
 */
export function getBackendOrigin(options: BackendUrlOptions = {}): string {
  const raw = firstNonEmpty(
    process.env.BACKEND_URL,
    process.env.STUDIO_API_BASE_URL,
    process.env.SHIPSEC_API_BASE_URL,
    process.env.API_BASE_URL,
  );

  if (raw) {
    return removeApiV1Suffix(raw);
  }

  if (options.preferDockerHost && isInDocker()) {
    return DEFAULT_DOCKER_BACKEND_ORIGIN;
  }

  return DEFAULT_BACKEND_ORIGIN;
}

export function getBackendApiV1Url(options: BackendUrlOptions = {}): string {
  return `${getBackendOrigin(options)}/api/v1`;
}
