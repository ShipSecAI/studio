import { ConfigurationError } from '@shipsec/component-sdk';

export const DEFAULT_API_BASE_URL =
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211';

export const DEFAULT_GATEWAY_URL = `${DEFAULT_API_BASE_URL}/mcp/gateway`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getGatewaySessionToken(
  runId: string,
  organizationId: string | null,
  connectedToolNodeIds?: string[],
): Promise<string> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set for agent tool discovery',
      { configKey: 'INTERNAL_SERVICE_TOKEN' },
    );
  }

  const url = `${DEFAULT_API_BASE_URL}/internal/mcp/generate-token`;
  // If connectedToolNodeIds is empty or undefined, we might still want to generate a token
  // without specific allowedNodeIds if the API supports it, or handle it otherwise.
  // The original code passed `allowedNodeIds: connectedToolNodeIds`.
  const body = { runId, organizationId, allowedNodeIds: connectedToolNodeIds };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate gateway session token: ${errorText}`);
  }

  const payload = await response.json();
  const token = isRecord(payload) && typeof payload.token === 'string' ? payload.token : null;
  if (!token) {
    throw new Error('Failed to generate gateway session token: invalid response shape');
  }
  return token;
}
