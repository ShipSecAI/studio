import type { ExecutionContext } from '@shipsec/component-sdk';

/**
 * Shared GitHub App authentication utilities for worker components.
 *
 * Provides token resolution via:
 * 1. Secrets service (pre-cached tokens)
 * 2. HTTP call to backend with installation ID
 * 3. HTTP call to backend with repository name (auto-resolution)
 */

/** API base URL for backend calls */
export const getApiBaseUrl = (): string =>
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211/api/v1';

/**
 * Build auth headers for internal worker-to-backend API calls.
 * Tries internal service token first, then falls back to Basic Auth.
 */
function getInternalAuthHeaders(): Record<string, string> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (internalToken) {
    return {
      'x-internal-token': internalToken,
      'x-organization-id': process.env.ORGANIZATION_ID ?? 'local-dev',
    };
  }

  // Fall back to Basic Auth for local development
  const username = process.env.STUDIO_API_USERNAME ?? process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.STUDIO_API_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'admin';
  const encoded =
    typeof btoa === 'function'
      ? btoa(`${username}:${password}`)
      : Buffer.from(`${username}:${password}`).toString('base64');

  return { Authorization: `Basic ${encoded}` };
}

/**
 * Sanitize any string to remove GitHub access tokens for safe logging.
 */
export function sanitizeForLogging(str: string): string {
  return str
    .replace(/x-access-token:[^@]+@/g, 'x-access-token:***@')
    .replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_***')
    .replace(/ghs_[a-zA-Z0-9]+/g, 'ghs_***');
}

/**
 * Fetch installation token using a known installation ID.
 * Tries secrets service first, then falls back to backend HTTP API.
 */
export async function fetchInstallationToken(
  installationId: number,
  context: ExecutionContext,
  logPrefix = '[GitHub]',
): Promise<string | null> {
  // Strategy 1: Try to get from secrets service (pre-cached tokens)
  if (context.secrets) {
    try {
      const tokenSecret = await context.secrets.get(`github-installation-${installationId}`);
      if (tokenSecret?.value) {
        context.logger.info(`${logPrefix} Retrieved installation token from secrets service`);
        return tokenSecret.value;
      }
    } catch (err) {
      context.logger.debug(
        `${logPrefix} Secrets service lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Strategy 2: Fetch fresh token via HTTP call to backend API
  if (context.http) {
    try {
      const baseUrl = getApiBaseUrl();
      const tokenUrl = `${baseUrl}/github/installations/${installationId}/token`;

      context.logger.info(`${logPrefix} Fetching installation token from backend API`);

      const response = await context.http.fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getInternalAuthHeaders(),
        },
      });

      if (response.ok) {
        const data = (await response.json()) as { token?: string };
        if (data.token) {
          context.logger.info(
            `${logPrefix} Successfully retrieved installation token from backend API`,
          );
          return data.token;
        }
      } else {
        context.logger.warn(
          `${logPrefix} Backend API token request failed with status ${response.status}`,
        );
      }
    } catch (err) {
      context.logger.warn(
        `${logPrefix} HTTP token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return null;
}
