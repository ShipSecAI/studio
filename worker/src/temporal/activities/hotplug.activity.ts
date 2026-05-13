import { HotplugClient, HotplugAttachment } from '../../utils/hotplug-client';
import { getBackendOrigin } from '../../utils/backend-url';

function getHotplugReachableBackendOrigin(): string {
  const hotplugOrigin = process.env.HOTPLUG_BACKEND_ORIGIN?.trim();
  if (hotplugOrigin) return hotplugOrigin.replace(/\/+$/, '');

  const origin = process.env.BACKEND_ORIGIN ?? getBackendOrigin();
  return origin
    .replace('://localhost', '://host.docker.internal')
    .replace('://127.0.0.1', '://host.docker.internal');
}

export interface CreateHotplugSessionInput {
  runId: string;
  organizationId: string;
  /** If omitted, built from BACKEND_ORIGIN env var + runId */
  componentToolsEndpoint?: string;
  mcpGroupAttachments?: {
    alias: string;
    runtime: 'docker' | 'host';
    command: string;
    args: string[];
    envVars?: Record<string, string>;
  }[];
  remoteMcpAttachments?: {
    alias: string;
    url: string;
    headers?: Record<string, string>;
  }[];
  includeComponentTools?: boolean;
}

export interface CreateHotplugSessionOutput {
  sessionId: string;
  mcpUrl: string;
  mcpToken: string;
}

export async function createHotplugSessionActivity(
  input: CreateHotplugSessionInput,
): Promise<CreateHotplugSessionOutput> {
  const hotplugClient = new HotplugClient();

  const backendOrigin = getHotplugReachableBackendOrigin();
  const endpoint =
    input.componentToolsEndpoint ?? `${backendOrigin}/api/v1/mcp/run-tools/${input.runId}`;

  const attachments: Record<string, HotplugAttachment> = {};

  if (input.includeComponentTools) {
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
    attachments['component-tools'] = {
      remote_http: {
        url: endpoint,
        headers: { 'x-internal-token': internalToken },
      },
    };
  }

  for (const group of input.mcpGroupAttachments ?? []) {
    attachments[group.alias] = {
      managed: {
        runtime: group.runtime,
        launch: { type: 'stdio', command: group.command, args: group.args },
        ...(group.envVars ? { secrets: { env_vars: group.envVars } } : {}),
      },
    };
  }

  for (const remote of input.remoteMcpAttachments ?? []) {
    attachments[remote.alias] = {
      remote_http: {
        url: remote.url,
        ...(remote.headers ? { headers: remote.headers } : {}),
      },
    };
  }

  const session = await hotplugClient.createSession({
    identity: {
      tenant_id: input.organizationId,
      user_id: 'system',
      run_id: input.runId,
    },
    lifecycle: {
      startup_timeout_ms: 30_000,
      idle_ttl_ms: 15 * 60 * 1000,
      max_duration_ms: 60 * 60 * 1000,
    },
    attachments,
  });

  if (!session.mcp_token) {
    throw new Error(`Hotplug session ${session.session_id} missing mcp_token`);
  }

  return {
    sessionId: session.session_id,
    mcpUrl: hotplugClient.sessionMcpEndpoint(session.session_id),
    mcpToken: session.mcp_token,
  };
}

export async function deleteHotplugSessionActivity(input: { sessionId: string }): Promise<void> {
  const hotplugClient = new HotplugClient();
  await hotplugClient.deleteSession(input.sessionId);
}
