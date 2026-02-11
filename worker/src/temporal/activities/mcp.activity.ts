import {
  componentRegistry,
  ConfigurationError,
  getCredentialInputIds,
  getToolMetadata,
  ServiceError,
} from '@shipsec/component-sdk';
import {
  CleanupLocalMcpActivityInput,
  RegisterComponentToolActivityInput,
  RegisterLocalMcpActivityInput,
  RegisterRemoteMcpActivityInput,
  AreAllToolsReadyActivityInput,
  AreAllToolsReadyActivityOutput,
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
  const url = `${baseUrl}/internal/mcp/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '<unable to read response body>');
    console.error(`[MCP Activity] API call failed: ${raw}`);
    throw new ServiceError(`Failed to call internal MCP registry (${path}): ${raw}`, {
      statusCode: response.status,
      details: { statusText: response.statusText },
    });
  }

  const result = await response.json();
  return result;
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

export async function cleanupLocalMcpActivity(input: CleanupLocalMcpActivityInput): Promise<void> {
  // In K8s mode there are no local Docker containers to clean up
  if (process.env.EXECUTION_MODE === 'k8s') return;

  const response = (await callInternalApi('cleanup', { runId: input.runId })) as {
    containerIds?: string[];
  };
  const containerIds = Array.isArray(response?.containerIds) ? response.containerIds : [];

  if (containerIds.length === 0) {
    return;
  }

  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  await Promise.all(
    containerIds.map(async (containerId: string) => {
      if (!containerId || typeof containerId !== 'string') return;
      if (!/^[a-zA-Z0-9_.-]+$/.test(containerId)) {
        console.warn(`[MCP Cleanup] Skipping container with unsafe id: ${containerId}`);
        return;
      }
      try {
        await execAsync(`docker rm -f ${containerId}`);
      } catch (error) {
        console.warn(`[MCP Cleanup] Failed to remove container ${containerId}:`, error);
      }
    }),
  );

  if (!/^[a-zA-Z0-9_.-]+$/.test(input.runId)) {
    console.warn(`[MCP Cleanup] Skipping volume cleanup with unsafe runId: ${input.runId}`);
    return;
  }

  try {
    const { stdout } = await execAsync(
      `docker volume ls --filter "label=studio.managed=true" --filter "label=studio.run=${input.runId}" --format "{{.Name}}"`,
    );
    const volumeNames = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (volumeNames.length === 0) {
      return;
    }

    await Promise.all(
      volumeNames.map(async (volumeName) => {
        if (!/^[a-zA-Z0-9_.-]+$/.test(volumeName)) {
          console.warn(`[MCP Cleanup] Skipping volume with unsafe name: ${volumeName}`);
          return;
        }
        try {
          await execAsync(`docker volume rm ${volumeName}`);
        } catch (error) {
          console.warn(`[MCP Cleanup] Failed to remove volume ${volumeName}:`, error);
        }
      }),
    );
  } catch (error) {
    console.warn(`[MCP Cleanup] Failed to list volumes for run ${input.runId}:`, error);
  }
}

export async function areAllToolsReadyActivity(
  input: AreAllToolsReadyActivityInput,
): Promise<AreAllToolsReadyActivityOutput> {
  const { runId, requiredNodeIds } = input;
  const response = await callInternalApi('tools-ready', {
    runId,
    requiredNodeIds,
  });
  return response as AreAllToolsReadyActivityOutput;
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
    toolName: input.nodeId.replace(/[^a-zA-Z0-9]/g, '_'),
    componentId: input.componentId,
    description: metadata.description,
    inputSchema: metadata.inputSchema,
    credentials,
  });
}
