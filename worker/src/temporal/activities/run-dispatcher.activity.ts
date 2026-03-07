import type { PreparedRunPayload } from '@shipsec/shared';
import { ConfigurationError } from '@shipsec/component-sdk';
import { createInternalBackendClient } from '../../utils/internal-backend-client';

import type { PrepareRunPayloadActivityInput } from '../types';

function normalizeNodeOverrides(
  value: PrepareRunPayloadActivityInput['nodeOverrides'],
):
  | Record<string, { params: Record<string, unknown>; inputOverrides: Record<string, unknown> }>
  | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, override]) => [
      key,
      {
        params: override.params ?? {},
        inputOverrides: override.inputOverrides ?? {},
      },
    ]),
  );
}

export async function prepareRunPayloadActivity(
  input: PrepareRunPayloadActivityInput,
): Promise<PreparedRunPayload> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal run endpoint',
      {
        configKey: 'INTERNAL_SERVICE_TOKEN',
      },
    );
  }

  const organizationId = input.organizationId ?? process.env.DEFAULT_ORGANIZATION_ID ?? null;
  const client = createInternalBackendClient({
    headers: organizationId ? { 'X-Organization-Id': organizationId } : undefined,
  });

  const response = await client.prepareRunPayload({
    workflowId: input.workflowId,
    inputs: input.inputs,
    versionId: input.versionId,
    version: input.version,
    nodeOverrides: normalizeNodeOverrides(input.nodeOverrides),
    trigger: input.trigger,
    runId: input.runId,
    parentRunId: input.parentRunId,
    parentNodeRef: input.parentNodeRef,
  });

  return response.data as PreparedRunPayload;
}
