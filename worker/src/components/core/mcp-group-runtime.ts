import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { HotplugClient } from '../../utils/hotplug-client';
import type { HotplugAttachment, HotplugTool } from '../../utils/hotplug-client';

/**
 * Schema for MCP Group Templates (code-defined)
 * Groups define credential contracts, server lists, and runtime behavior
 */
export const McpGroupTemplateSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  credentialContractName: z.string(),
  defaultDockerImage: z.string(),
  credentialMapping: z.object({
    env: z.record(z.string(), z.string()),
    awsFiles: z.boolean().optional(),
  }),
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      command: z.string(),
      args: z.array(z.string()).optional(),
    }),
  ),
});

export type McpGroupTemplate = z.infer<typeof McpGroupTemplateSchema>;

/**
 * Output from a single MCP server in a group
 */
export interface McpServerEndpoint {
  endpoint: string;
  sessionId: string;
  serverId: string;
}

/**
 * Interface for credential contracts
 * Matches AWS credential structure, can be extended for other providers
 */
export const GroupCredentialsSchema = z.object({
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  region: z.string().optional(),
});

export type GroupCredentials = z.infer<typeof GroupCredentialsSchema>;

/**
 * Maps credential contract values to environment variables
 * Supports both direct env mapping and AWS file generation
 */
function buildCredentialEnv(
  credentials: Record<string, unknown>,
  mapping: McpGroupTemplate['credentialMapping'],
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [envKey, credentialKey] of Object.entries(mapping.env)) {
    const isOptional = credentialKey.endsWith('?');
    const actualKey = isOptional ? credentialKey.slice(0, -1) : credentialKey;
    const value = credentials[actualKey];

    if (value !== undefined && value !== null) {
      env[envKey] = String(value);
    } else if (!isOptional) {
      throw new Error(`Required credential field missing: ${actualKey}`);
    }
  }

  return env;
}

/**
 * Main execution function for MCP Group nodes
 *
 * This helper:
 * 1. Takes credential contract inputs
 * 2. Takes enabledServers[] parameter
 * 3. Creates ONE Hotplug session with all enabled servers as attachments
 * 4. Each server becomes an attachment keyed by server.id
 * 5. Discovers tools via Hotplug session response and registers them with the backend
 * 6. Returns array of { endpoint, sessionId, serverId }
 *
 * @param context - Execution context
 * @param inputs - Input data including credentials
 * @param params - Component parameters including enabledServers
 * @param groupTemplate - Group template defining servers and credential mapping
 * @returns Array of server endpoints
 */
export async function executeMcpGroupNode(
  context: ExecutionContext,
  inputs: { credentials: Record<string, unknown> },
  params: { enabledServers: string[] },
  groupTemplate: McpGroupTemplate,
): Promise<{ endpoints: McpServerEndpoint[] }> {
  const enabledServers = params.enabledServers || [];
  console.log(`[executeMcpGroupNode] ============================================`);
  console.log(`[executeMcpGroupNode] Starting execution for group ${groupTemplate.slug}`);
  console.log(`[executeMcpGroupNode] Component ref: ${context.componentRef}`);
  console.log(`[executeMcpGroupNode] Run ID: ${context.runId}`);
  console.log(`[executeMcpGroupNode] Enabled servers: ${enabledServers.join(', ')}`);

  const credentials = inputs.credentials;

  if (!credentials || Object.keys(credentials).length === 0) {
    throw new Error('Credentials are required for MCP group execution');
  }

  if (enabledServers.length === 0) {
    console.log(`[executeMcpGroupNode] No enabled servers, returning empty endpoints`);
    return { endpoints: [] };
  }

  // Build environment variables from credential mapping
  const env = buildCredentialEnv(credentials, groupTemplate.credentialMapping);
  console.log(`[executeMcpGroupNode] Built credential env:`, Object.keys(env));

  // Get enabled servers from template
  const enabledServerTemplates = groupTemplate.servers.filter((s) => enabledServers.includes(s.id));

  console.log(
    `[executeMcpGroupNode] Processing ${enabledServerTemplates.length} enabled servers from template`,
  );

  // Build Hotplug attachments: one per enabled server, keyed by server.id
  const attachments: Record<string, HotplugAttachment> = {};
  for (const serverTemplate of enabledServerTemplates) {
    const args = [
      'run',
      '--rm',
      '-i',
      '--init',
      groupTemplate.defaultDockerImage,
      'uvx',
      serverTemplate.command,
    ];
    if (serverTemplate.args) {
      args.push(...serverTemplate.args);
    }

    attachments[serverTemplate.id] = {
      managed: {
        runtime: 'docker',
        launch: {
          type: 'stdio',
          command: 'docker',
          args,
        },
        secrets: { env_vars: env },
      },
    };
  }

  console.log(`[executeMcpGroupNode] Built ${Object.keys(attachments).length} Hotplug attachments`);

  const hotplug = new HotplugClient();
  const tenantId = (context as any).tenantId ?? 'default-tenant';

  // Create ONE Hotplug session with all servers as attachments
  console.log(`[executeMcpGroupNode] Creating Hotplug session...`);
  const session = await hotplug.createSession({
    identity: {
      tenant_id: tenantId,
      user_id: context.componentRef,
      run_id: context.runId,
      labels: { group: groupTemplate.slug },
    },
    attachments,
  });

  const sessionId = session.session_id;
  const mcpEndpoint = hotplug.sessionMcpEndpoint(sessionId);
  console.log(`[executeMcpGroupNode] Hotplug session created: ${sessionId}`);
  console.log(`[executeMcpGroupNode] MCP proxy endpoint: ${mcpEndpoint}`);

  // Collect tools from the session response and register each server with backend
  const endpoints: McpServerEndpoint[] = [];

  for (const serverTemplate of enabledServerTemplates) {
    const attachmentState = session.state.attachments[serverTemplate.id];
    const tools: HotplugTool[] = attachmentState?.tools ?? [];

    console.log(
      `[executeMcpGroupNode] Server ${serverTemplate.id}: ${tools.length} tools discovered`,
    );

    // Register with backend using hierarchical node ID
    await registerServerWithBackend(serverTemplate.id, mcpEndpoint, sessionId, context, tools);

    endpoints.push({
      endpoint: mcpEndpoint,
      sessionId,
      serverId: serverTemplate.id,
    });
  }

  console.log(`[executeMcpGroupNode] ============================================`);
  console.log(`[executeMcpGroupNode] Execution complete!`);
  console.log(`[executeMcpGroupNode] Total endpoints: ${endpoints.length}`);
  console.log(
    `[executeMcpGroupNode] Endpoints:`,
    endpoints.map((e) => `${e.serverId} -> ${e.endpoint}`),
  );
  console.log(`[executeMcpGroupNode] ============================================`);
  return { endpoints };
}

/**
 * Registers a server with the backend Tool Registry using the new clean API.
 *
 * Uses the /register-mcp-server endpoint which accepts pre-discovered tools.
 */
async function registerServerWithBackend(
  serverId: string,
  endpoint: string,
  sessionId: string,
  context: ExecutionContext,
  tools: HotplugTool[],
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3211';
  const internalApiUrl = `${backendUrl}/api/v1/internal/mcp`;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token';

  // Use a unique nodeId for each server to avoid overwriting in Redis
  // Format: ${groupNodeId}/${serverId} (e.g., "aws-mcp-group/aws-cloudtrail")
  const uniqueNodeId = `${context.componentRef}/${serverId}`;

  console.log(`[registerServerWithBackend] Registering server ${serverId}`);
  console.log(`[registerServerWithBackend] Unique nodeId: ${uniqueNodeId}`);
  console.log(`[registerServerWithBackend] Endpoint: ${endpoint}`);
  console.log(`[registerServerWithBackend] Tools: ${tools.length}`);

  // Register using the new clean API
  const registerResponse = await fetch(`${internalApiUrl}/register-mcp-server`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': internalToken,
    },
    body: JSON.stringify({
      runId: context.runId,
      nodeId: uniqueNodeId,
      serverName: serverId,
      serverId,
      transport: 'stdio',
      endpoint,
      sessionId,
      tools,
    }),
  });

  if (!registerResponse.ok) {
    const errorText = await registerResponse.text();
    console.error(`[registerServerWithBackend] Registration failed: ${errorText}`);
    throw new Error(`Failed to register server ${serverId}: ${registerResponse.statusText}`);
  }

  console.log(`[registerServerWithBackend] Registered ${serverId} with ${tools.length} tools`);
}
