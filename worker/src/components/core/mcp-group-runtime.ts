import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';
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
 * Fetches server details from the MCP Group Servers API
 */
async function fetchGroupServers(
  groupSlug: string,
  serverIds: string[],
  context: ExecutionContext,
): Promise<McpServerEndpoint[]> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  const internalApiUrl = `${backendUrl}/internal/mcp`;

  // Generate internal API token
  const tokenResponse = await fetch(`${internalApiUrl}/generate-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: context.runId,
      allowedNodeIds: [context.componentRef],
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to generate internal API token: ${tokenResponse.statusText}`);
  }

  const { token } = (await tokenResponse.json()) as { token: string };

  const results: McpServerEndpoint[] = [];

  for (const serverId of serverIds) {
    try {
      const registerResponse = await fetch(`${internalApiUrl}/register-group-server`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          runId: context.runId,
          nodeId: context.componentRef,
          groupSlug,
          serverId,
        }),
      });

      if (!registerResponse.ok) {
        throw new Error(`Failed to fetch server ${serverId}: ${registerResponse.statusText}`);
      }

      const serverData = (await registerResponse.json()) as {
        command: string;
        args?: string[];
        endpoint?: string;
      };

      // For HTTP servers, return directly
      if (serverData.endpoint) {
        results.push({
          endpoint: serverData.endpoint,
          containerId: '',
          serverId,
        });
      }
      // For stdio servers, we'll start containers below
    } catch (error) {
      console.error(`Failed to fetch server ${serverId}:`, error);
      throw error;
    }
  }

  return results;
}

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
  const credentials = inputs.credentials;
  const enabledServers = params.enabledServers || [];

  if (!credentials || Object.keys(credentials).length === 0) {
    throw new Error('Credentials are required for MCP group execution');
  }

  if (enabledServers.length === 0) {
    return { endpoints: [] };
  }

  // Build environment variables from credential mapping
  const env = buildCredentialEnv(credentials, groupTemplate.credentialMapping);

  // Fetch server details from backend
  const serverDetails = await fetchGroupServers(groupTemplate.slug, enabledServers, context);

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

    // Start container for each stdio server
    for (const serverDetail of serverDetails) {
      if (!serverDetail.endpoint) {
        // This is a stdio server, need to start container
        const serverTemplate = groupTemplate.servers.find((s) => s.id === serverDetail.serverId);

        if (!serverTemplate) {
          throw new Error(`Server template not found: ${serverDetail.serverId}`);
        }

        // Set MCP_COMMAND for the stdio proxy
        const serverEnv: Record<string, string> = {
          ...env,
          MCP_COMMAND: serverTemplate.command,
        };

        if (serverTemplate.args && serverTemplate.args.length > 0) {
          serverEnv.MCP_ARGS = JSON.stringify(serverTemplate.args);
        }

        const result = await startMcpDockerServer({
          image: groupTemplate.defaultDockerImage,
          command: serverTemplate.command.split(' '),
          env: serverEnv,
          port: 0, // Auto-assign port
          params: {},
          context,
          volumes,
        });

        // Register with backend
        await registerServerWithBackend(
          serverDetail.serverId,
          result.endpoint,
          result.containerId ?? '',
          context,
        );

        endpoints.push({
          endpoint: result.endpoint,
          containerId: result.containerId || '',
          serverId: serverDetail.serverId,
        });
      } else {
        // HTTP server, already has endpoint
        endpoints.push(serverDetail);
      }
    }

    return { endpoints };
  } catch (error) {
    // Cleanup volume on error
    if (volume) {
      await volume.cleanup().catch(() => {});
    }
    throw error;
  }
}

/**
 * Registers a server with the backend Tool Registry
 */
async function registerServerWithBackend(
  serverId: string,
  endpoint: string,
  containerId: string,
  context: ExecutionContext,
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  const internalApiUrl = `${backendUrl}/internal/mcp`;

  // Generate internal API token
  const tokenResponse = await fetch(`${internalApiUrl}/generate-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: context.runId,
      allowedNodeIds: [context.componentRef],
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to generate internal API token: ${tokenResponse.statusText}`);
  }

  const { token } = (await tokenResponse.json()) as { token: string };

  // Register the local MCP with the Tool Registry
  const registerResponse = await fetch(`${internalApiUrl}/register-local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      runId: context.runId,
      nodeId: context.componentRef,
      toolName: serverId,
      description: `MCP tools from ${serverId}`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      endpoint,
      containerId,
    }),
  });

  if (!registerResponse.ok) {
    throw new Error(`Failed to register server ${serverId}: ${registerResponse.statusText}`);
  }
}
