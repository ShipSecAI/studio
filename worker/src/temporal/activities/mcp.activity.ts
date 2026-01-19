import { ConfigurationError, ServiceError } from '@shipsec/component-sdk';
import type { RegisterToolActivityInput } from '../types';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const DEFAULT_API_BASE_URL =
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211';

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function readErrorBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unable to read response body>';
  }
}

/**
 * Activity to register a tool in the backend Tool Registry.
 */
export async function registerToolActivity(input: RegisterToolActivityInput): Promise<void> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal registration endpoint',
      {
        configKey: 'INTERNAL_SERVICE_TOKEN',
      },
    );
  }

  const baseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Token': internalToken,
  };

  const response = await fetch(`${baseUrl}/internal/mcp/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const raw = await readErrorBody(response);
    throw new ServiceError(`Failed to register tool in registry: ${raw}`, {
      statusCode: response.status,
      details: { statusText: response.statusText, toolName: input.toolName },
    });
  }
}
