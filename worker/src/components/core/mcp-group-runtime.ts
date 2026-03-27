import { z } from 'zod';
import type { ExecutionContext } from '@shipsec/component-sdk';

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
 * Attachment spec returned by executeMcpGroupNode.
 * The workflow passes these to createHotplugSessionActivity, which creates
 * a single Hotplug session with all attachments.
 */
export interface McpGroupAttachmentSpec {
  alias: string;
  runtime: 'docker' | 'host';
  command: string;
  args: string[];
  envVars: Record<string, string>;
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
 * Main execution function for MCP Group nodes.
 *
 * Builds Hotplug attachment specs for each enabled server.
 * Does NOT create a Hotplug session — that is delegated to
 * createHotplugSessionActivity in the workflow orchestration.
 *
 * @param context - Execution context
 * @param inputs - Input data including credentials
 * @param params - Component parameters including enabledServers
 * @param groupTemplate - Group template defining servers and credential mapping
 * @returns Array of attachment specs for the workflow to pass to Hotplug
 */
export async function executeMcpGroupNode(
  context: ExecutionContext,
  inputs: { credentials: Record<string, unknown> },
  params: { enabledServers: string[] },
  groupTemplate: McpGroupTemplate,
): Promise<{ attachmentSpecs: McpGroupAttachmentSpec[] }> {
  const enabledServers = params.enabledServers || [];
  console.log(
    `[executeMcpGroupNode] Starting for group ${groupTemplate.slug}, run ${context.runId}`,
  );
  console.log(`[executeMcpGroupNode] Enabled servers: ${enabledServers.join(', ')}`);

  const credentials = inputs.credentials;

  if (!credentials || Object.keys(credentials).length === 0) {
    throw new Error('Credentials are required for MCP group execution');
  }

  if (enabledServers.length === 0) {
    console.log(`[executeMcpGroupNode] No enabled servers, returning empty attachment specs`);
    return { attachmentSpecs: [] };
  }

  // Build environment variables from credential mapping
  const env = buildCredentialEnv(credentials, groupTemplate.credentialMapping);
  console.log(`[executeMcpGroupNode] Built credential env:`, Object.keys(env));

  // Get enabled servers from template
  const enabledServerTemplates = groupTemplate.servers.filter((s) => enabledServers.includes(s.id));

  console.log(
    `[executeMcpGroupNode] Building attachment specs for ${enabledServerTemplates.length} servers`,
  );

  // Build one attachment spec per enabled server.
  // Hotplug wraps the command in the default runtime image automatically.
  const attachmentSpecs: McpGroupAttachmentSpec[] = enabledServerTemplates.map((serverTemplate) => {
    return {
      alias: serverTemplate.id,
      runtime: 'docker' as const,
      command: serverTemplate.command,
      args: serverTemplate.args ?? [],
      envVars: env,
    };
  });

  console.log(`[executeMcpGroupNode] Returning ${attachmentSpecs.length} attachment specs`);
  return { attachmentSpecs };
}
