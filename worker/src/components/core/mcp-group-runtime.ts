import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpDockerServer } from './mcp-runtime';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

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
  containerId: string;
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
 * Generates AWS credentials and config files for IsolatedContainerVolume
 */
function buildAwsCredentialFiles(
  credentials: Record<string, unknown>,
): { credentials: string; config: string } | null {
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    return null;
  }

  const region = credentials.region || 'us-east-1';

  const credsLines = [
    '[default]',
    `aws_access_key_id = ${credentials.accessKeyId}`,
    `aws_secret_access_key = ${credentials.secretAccessKey}`,
  ];

  if (credentials.sessionToken) {
    credsLines.push(`aws_session_token = ${credentials.sessionToken}`);
  }

  const configLines = ['[default]', `region = ${region}`, 'output = json'];

  return {
    credentials: credsLines.join('\n'),
    config: configLines.join('\n'),
  };
}

/**
 * Main execution function for MCP Group nodes
 *
 * This helper:
 * 1. Takes credential contract inputs
 * 2. Takes enabledServers[] parameter
 * 3. For each enabled server:
 *    - Creates IsolatedContainerVolume with credentials
 *    - Starts container using group's defaultDockerImage
 *    - Sets MCP_COMMAND environment variable for the server
 *    - Calls /internal/mcp/register-local for each
 * 4. Returns array of { endpoint, containerId, serverId }
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
  console.log(
    `[executeMcpGroupNode] [DEBUG] componentRef should match workflow node ID for proper gateway filtering`,
  );
  console.log(
    `[executeMcpGroupNode] [DEBUG] Child server nodeIds will be: ${enabledServers.map((s) => `${context.componentRef}/${s}`).join(', ')}`,
  );

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

  // Get enabled servers from template (no API call needed!)
  const enabledServerTemplates = groupTemplate.servers.filter((s) => enabledServers.includes(s.id));

  console.log(
    `[executeMcpGroupNode] Processing ${enabledServerTemplates.length} enabled servers from template`,
  );

  const endpoints: McpServerEndpoint[] = [];
  const volumes: ReturnType<IsolatedContainerVolume['getVolumeConfig']>[] = [];
  let volume: IsolatedContainerVolume | null = null;

  try {
    // Create volume if AWS files are needed
    if (groupTemplate.credentialMapping.awsFiles) {
      const awsFiles = buildAwsCredentialFiles(credentials);
      if (awsFiles) {
        const tenantId = (context as any).tenantId ?? 'default-tenant';
        volume = new IsolatedContainerVolume(tenantId, context.runId);
        await volume.initialize({
          credentials: awsFiles.credentials,
          config: awsFiles.config,
        });
        volumes.push(volume.getVolumeConfig('/root/.aws', true));
      }
    }

    // Process each enabled server
    for (const serverTemplate of enabledServerTemplates) {
      console.log(`[executeMcpGroupNode] ----------------------------------------`);
      console.log(`[executeMcpGroupNode] Starting container for server: ${serverTemplate.id}`);
      console.log(`[executeMcpGroupNode] Command: ${serverTemplate.command}`);
      console.log(`[executeMcpGroupNode] Args: ${JSON.stringify(serverTemplate.args || [])}`);
      console.log(`[executeMcpGroupNode] Image: ${groupTemplate.defaultDockerImage}`);

      // Set MCP_COMMAND for the stdio proxy
      // MCP_NAMED_SERVERS='{}' disables the built-in named-servers.json config
      // so the proxy falls through to MCP_COMMAND mode
      const serverEnv: Record<string, string> = {
        ...env,
        MCP_COMMAND: serverTemplate.command,
        MCP_NAMED_SERVERS: '{}',
      };

      if (serverTemplate.args && serverTemplate.args.length > 0) {
        serverEnv.MCP_ARGS = JSON.stringify(serverTemplate.args);
      }

      console.log(`[executeMcpGroupNode] Env vars:`, Object.keys(serverEnv));

      const result = await startMcpDockerServer({
        image: groupTemplate.defaultDockerImage,
        command: [],
        env: serverEnv,
        port: 0, // Auto-assign port
        params: {},
        context,
        volumes,
      });

      console.log(`[executeMcpGroupNode] Container started successfully!`);
      console.log(`[executeMcpGroupNode] Endpoint: ${result.endpoint}`);
      console.log(`[executeMcpGroupNode] Container ID: ${result.containerId}`);

      // Register with backend using hierarchical node ID (parent/child format)
      // This allows explicit hierarchical queries instead of fragile prefix matching
      const uniqueNodeId = `${context.componentRef}/${serverTemplate.id}`;
      console.log(`[executeMcpGroupNode] Registering with backend...`);
      console.log(`[executeMcpGroupNode] Unique nodeId: ${uniqueNodeId}`);
      console.log(
        `[executeMcpGroupNode] Backend URL: ${process.env.BACKEND_URL || 'http://localhost:3211'}`,
      );

      await registerServerWithBackend(
        serverTemplate.id,
        result.endpoint,
        result.containerId ?? '',
        context,
      );

      console.log(`[executeMcpGroupNode] Registration successful!`);

      endpoints.push({
        endpoint: result.endpoint,
        containerId: result.containerId || '',
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
  } catch (error) {
    // Cleanup volume on error
    if (volume) {
      await volume.cleanup().catch(() => { });
    }
    throw error;
  }
}

/**
 * Schema for discovered MCP tools
 */
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Discover tools from an MCP endpoint with exponential backoff retry.
 *
 * Uses the MCP SDK Client + StreamableHTTPClientTransport so that a proper
 * `initialize` handshake is performed before `tools/list`.  Many MCP servers
 * (including the AWS MCP servers) reject a bare `tools/list` request without
 * a preceding `initialize`, which caused the old raw-fetch implementation to
 * silently return zero tools.
 */
async function discoverToolsWithRetry(
  endpoint: string,
  maxRetries = 8,
  baseDelayMs = 1000,
): Promise<McpTool[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client: Client | null = null;
    try {
      console.log(
        `[discoverToolsWithRetry] Attempt ${attempt}/${maxRetries}: Discovering tools from ${endpoint}`,
      );

      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Accept: 'application/json, text/event-stream',
          },
        },
      });

      client = new Client(
        { name: 'shipsec-worker-tool-discovery', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      const res = await client.listTools();
      await client.close().catch(() => {});

      const tools: McpTool[] = (res.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
      console.log(
        `[discoverToolsWithRetry] ✓ Discovered ${tools.length} tools on attempt ${attempt}`,
      );
      return tools;
    } catch (error) {
      lastError = error as Error;
      await client?.close().catch(() => {});
      console.warn(`[discoverToolsWithRetry] Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxRetries) {
        const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 5000);
        console.log(`[discoverToolsWithRetry] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(
    `[discoverToolsWithRetry] ✗ Failed after ${maxRetries} attempts: ${lastError?.message}`,
  );
  return [];
}

/**
 * Registers a server with the backend Tool Registry using the new clean API.
 *
 * Uses the /register-mcp-server endpoint which accepts pre-discovered tools.
 */
async function registerServerWithBackend(
  serverId: string,
  endpoint: string,
  containerId: string,
  context: ExecutionContext,
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

  // Discover tools from endpoint with retry logic
  console.log(`[registerServerWithBackend] Discovering tools from endpoint...`);
  const discoveredTools = await discoverToolsWithRetry(endpoint);
  console.log(`[registerServerWithBackend] Discovered ${discoveredTools.length} tools`);

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
      containerId,
      tools: discoveredTools,
    }),
  });

  if (!registerResponse.ok) {
    const errorText = await registerResponse.text();
    console.error(`[registerServerWithBackend] Registration failed: ${errorText}`);
    throw new Error(`Failed to register server ${serverId}: ${registerResponse.statusText}`);
  }

  console.log(
    `[registerServerWithBackend] ✓ Registered ${serverId} with ${discoveredTools.length} tools`,
  );
}
