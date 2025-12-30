import type { PreparedRunPayload } from '@shipsec/shared';
import { ConfigurationError, ServiceError } from '@shipsec/component-sdk';

import type { PrepareRunPayloadActivityInput } from '../types';

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

export async function prepareRunPayloadActivity(
  input: PrepareRunPayloadActivityInput,
): Promise<PreparedRunPayload> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError('INTERNAL_SERVICE_TOKEN env var must be set to call internal run endpoint', {
      configKey: 'INTERNAL_SERVICE_TOKEN',
    });
  }

  const baseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);
  const organizationId = input.organizationId ?? process.env.DEFAULT_ORGANIZATION_ID ?? null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Token': internalToken,
  };

  if (organizationId) {
    headers['X-Organization-Id'] = organizationId;
  }

  const response = await fetch(`${baseUrl}/internal/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflowId: input.workflowId,
      inputs: input.inputs,
      versionId: input.versionId,
      version: input.version,
      nodeOverrides: input.nodeOverrides,
      trigger: input.trigger,
      runId: input.runId,
    }),
  });

  if (!response.ok) {
    const raw = await readErrorBody(response);
    throw new ServiceError(
      `Failed to prepare run payload: ${raw}`,
      {
        statusCode: response.status,
        details: { statusText: response.statusText, workflowId: input.workflowId },
      },
    );
  }

  return (await response.json()) as PreparedRunPayload;
}
