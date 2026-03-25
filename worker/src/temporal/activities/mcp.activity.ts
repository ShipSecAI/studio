import {
  componentRegistry,
  ConfigurationError,
  getCredentialInputIds,
  isAgentCallable,
  getToolMetadata,
  ServiceError,
} from '@shipsec/component-sdk';
import {
  CleanupRunResourcesActivityInput,
  RegisterComponentToolActivityInput,
  RegisterLocalMcpActivityInput,
  RegisterRemoteMcpActivityInput,
  AreAllToolsReadyActivityInput,
  AreAllToolsReadyActivityOutput,
} from '../types';
import { createInternalBackendClient } from '../../utils/internal-backend-client';
import { HotplugClient } from '../../utils/hotplug-client';

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

  const client = createInternalBackendClient();
  const response =
    path === 'register-component'
      ? await client.registerInternalComponentTool(body)
      : path === 'register-mcp-server'
        ? await client.registerInternalMcpServer(body)
        : path === 'cleanup'
          ? await client.cleanupInternalMcpRun(body)
          : path === 'tools-ready'
            ? await client.areInternalMcpToolsReady(body)
            : path === 'register-group-server'
              ? await client.registerInternalGroupServer(body)
              : null;

  if (!response) {
    throw new ServiceError(`Unsupported internal MCP path: ${path}`);
  }

  return response.data;
}

export async function registerComponentToolActivity(
  input: RegisterComponentToolActivityInput,
): Promise<void> {
  await callInternalApi('register-component', input);
}

export async function registerRemoteMcpActivity(
  input: RegisterRemoteMcpActivityInput,
): Promise<void> {
  await callInternalApi('register-mcp-server', {
    runId: input.runId,
    nodeId: input.nodeId,
    serverName: input.toolName,
    transport: 'http' as const,
    endpoint: input.endpoint,
    ...(input.authToken ? { headers: { Authorization: `Bearer ${input.authToken}` } } : {}),
  });
}

export async function registerLocalMcpActivity(
  input: RegisterLocalMcpActivityInput,
): Promise<void> {
  const port = input.port || 8080;
  const endpoint = input.endpoint || `http://localhost:${port}`;

  await callInternalApi('register-mcp-server', {
    runId: input.runId,
    nodeId: input.nodeId,
    serverName: input.toolName,
    transport: 'stdio' as const,
    endpoint,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
}

export async function cleanupRunResourcesActivity(
  input: CleanupRunResourcesActivityInput,
): Promise<void> {
  const response = (await callInternalApi('cleanup', { runId: input.runId })) as {
    sessionIds?: string[];
  };
  const registeredIds = Array.isArray(response?.sessionIds) ? response.sessionIds : [];
  const orphanIds = Array.isArray(input.orphanSessionIds) ? input.orphanSessionIds : [];
  const sessionIds = [...new Set([...registeredIds, ...orphanIds])];

  if (sessionIds.length === 0) {
    console.log(`[MCP Cleanup] No sessions to clean up for run ${input.runId}`);
    return;
  }

  console.log(
    `[MCP Cleanup] Deleting ${sessionIds.length} Hotplug session(s) for run ${input.runId}`,
  );

  const hotplug = new HotplugClient();
  await Promise.all(
    sessionIds.map(async (sessionId: string) => {
      try {
        await hotplug.deleteSession(sessionId);
        console.log(`[MCP Cleanup] Deleted Hotplug session: ${sessionId}`);
      } catch (error) {
        console.warn(`[MCP Cleanup] Failed to delete Hotplug session ${sessionId}:`, error);
      }
    }),
  );
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
  const exposedToAgent = isAgentCallable(component);

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
    toolName: metadata.name || input.nodeId.replace(/[^a-zA-Z0-9]/g, '_'),
    exposedToAgent,
    componentId: input.componentId,
    description: metadata.description,
    inputSchema: metadata.inputSchema,
    parameters: input.params,
    credentials,
    preparedInputs: input.inputs,
    preparedParams: input.params,
  });
}
