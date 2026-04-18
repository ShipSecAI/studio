import {
  ConfigurationError,
  DEFAULT_SENSITIVE_HEADERS,
  fromHttpResponse,
  type ExecutionContext,
} from '@shipsec/component-sdk';

import { getBackendApiV1Url } from '../../utils/backend-url';

export async function fetchConnectionCredentials(
  connectionId: string,
  organizationId: string | null,
  context: ExecutionContext,
): Promise<{
  credentialType: string;
  provider: string;
  data: Record<string, unknown>;
  accountId?: string;
  region?: string;
  displayName?: string;
}> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const baseUrl = getBackendApiV1Url();

  if (!internalToken) {
    context.emitProgress({
      level: 'warn',
      message:
        'INTERNAL_SERVICE_TOKEN env var not set; requesting credentials without internal auth header.',
    });
  }

  const sensitiveHeaders = internalToken
    ? Array.from(new Set([...DEFAULT_SENSITIVE_HEADERS, 'x-internal-token', 'x-organization-id']))
    : DEFAULT_SENSITIVE_HEADERS;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (internalToken) {
    headers['X-Internal-Token'] = internalToken;
  }
  if (organizationId) {
    headers['X-Organization-Id'] = organizationId;
  }

  const response = await context.http.fetch(
    `${baseUrl}/integrations/connections/${encodeURIComponent(connectionId)}/credentials`,
    {
      method: 'POST',
      headers,
    },
    { sensitiveHeaders },
  );

  if (!response.ok) {
    const raw = await safeReadText(response);
    throw fromHttpResponse(
      response,
      `Failed to resolve credentials for connection ${connectionId}: ${raw}`,
    );
  }

  const payload = (await response.json()) as {
    credentialType?: string;
    provider?: string;
    data?: Record<string, unknown>;
    accountId?: string;
    region?: string;
    displayName?: string;
  };

  if (!payload.credentialType || !payload.provider) {
    throw new ConfigurationError(
      `Connection ${connectionId} returned an incomplete credential response.`,
      {
        configKey: 'connectionId',
        details: { connectionId },
      },
    );
  }

  return {
    credentialType: payload.credentialType,
    provider: payload.provider,
    data: payload.data ?? {},
    accountId: payload.accountId,
    region: payload.region,
    displayName: payload.displayName,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `<<unable to read body: ${(error as Error).message}>>`;
  }
}
