import {
  componentRegistry,
  ConfigurationError,
  getCredentialInputIds,
  getToolMetadata,
  ServiceError,
} from '@shipsec/component-sdk';
import {
  RegisterComponentToolActivityInput,
  RegisterLocalMcpActivityInput,
  RegisterRemoteMcpActivityInput,
} from '../types';

const DEFAULT_API_BASE_URL =
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211';

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function callInternalApi(path: string, body: any) {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal MCP registry',
      {
        configKey: 'INTERNAL_SERVICE_TOKEN',
      },
    );
  }

  const baseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);
  const response = await fetch(`${baseUrl}/internal/mcp/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '<unable to read response body>');
    throw new ServiceError(`Failed to call internal MCP registry (${path}): ${raw}`, {
      statusCode: response.status,
      details: { statusText: response.statusText },
    });
  }

  return response.json();
}

export async function registerComponentToolActivity(
  input: RegisterComponentToolActivityInput,
): Promise<void> {
  await callInternalApi('register-component', input);
}

export async function registerRemoteMcpActivity(
  input: RegisterRemoteMcpActivityInput,
): Promise<void> {
  await callInternalApi('register-remote', input);
}

export async function registerLocalMcpActivity(
  input: RegisterLocalMcpActivityInput,
): Promise<void> {
  const port = input.port || 8080;
  // Use provided endpoint/containerId or fall back to defaults
  const endpoint = input.endpoint || `http://localhost:${port}`;
  const containerId = input.containerId || `docker-${input.image.replace(/[^a-zA-Z0-9]/g, '-')}`;

  await callInternalApi('register-local', {
    ...input,
    endpoint,
    containerId,
  });
}

export async function prepareAndRegisterToolActivity(input: {
  runId: string;
  nodeId: string;
  componentId: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
}): Promise<void> {
  const component = componentRegistry.get(input.componentId);
  if (!component) {
    throw new ServiceError(`Component ${input.componentId} not found`);
  }

  const metadata = getToolMetadata(component);
  const credentialIds = getCredentialInputIds(component);

  // Extract credentials from inputs/params
  const allInputs = { ...input.inputs, ...input.params };
  const credentials: Record<string, unknown> = {};
  for (const id of credentialIds) {
    if (id in allInputs) {
      credentials[id] = allInputs[id];
    }
  }

  await callInternalApi('register-component', {
    runId: input.runId,
    nodeId: input.nodeId,
    toolName: metadata.name,
    componentId: input.componentId,
    description: metadata.description,
    inputSchema: metadata.inputSchema,
    credentials,
  });
}
