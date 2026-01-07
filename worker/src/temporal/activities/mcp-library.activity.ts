/**
 * MCP Library Activities
 *
 * Temporal activities for interacting with MCP servers configured in the MCP Library.
 * Used by the AI Agent component to fetch enabled servers, health check them,
 * and discover available tools.
 */

import { ConfigurationError, ServiceError } from '@shipsec/component-sdk';
import {
  getMcpClientService,
  type McpServerConfig,
  type McpHealthResult,
  type McpToolInfo,
} from '../../services/mcp-client.service.js';

// Backend API response types
interface McpServerApiResponse {
  id: string;
  name: string;
  description?: string | null;
  transportType: 'http' | 'stdio' | 'sse' | 'websocket';
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  hasHeaders: boolean;
  enabled: boolean;
  healthCheckUrl?: string | null;
  lastHealthCheck?: string | null;
  lastHealthStatus?: 'healthy' | 'unhealthy' | 'unknown' | null;
}

interface McpServerWithHeadersApiResponse extends McpServerApiResponse {
  headers?: Record<string, string> | null;
}

// Activity input/output types
export interface FetchEnabledMcpServersInput {
  organizationId?: string | null;
}

export interface FetchEnabledMcpServersOutput {
  servers: McpServerConfig[];
}

export interface HealthCheckMcpServerInput {
  server: McpServerConfig;
}

export interface HealthCheckMcpServerOutput {
  result: McpHealthResult;
}

export interface DiscoverMcpServerToolsInput {
  server: McpServerConfig;
}

export interface DiscoverMcpServerToolsOutput {
  tools: McpToolInfo[];
  error?: string;
}

export interface BatchHealthCheckInput {
  servers: McpServerConfig[];
}

export interface BatchHealthCheckOutput {
  results: McpHealthResult[];
}

// API configuration
const DEFAULT_API_BASE_URL =
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211';

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unable to read response body>';
  }
}

function getInternalToken(): string {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call MCP library API',
      { configKey: 'INTERNAL_SERVICE_TOKEN' }
    );
  }
  return token;
}

function buildHeaders(organizationId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Token': getInternalToken(),
  };

  if (organizationId) {
    headers['X-Organization-Id'] = organizationId;
  }

  return headers;
}

/**
 * Activity: Fetch all enabled MCP servers from the backend.
 *
 * This calls the internal API endpoint to get enabled servers with their
 * decrypted headers for authentication.
 */
export async function fetchEnabledMcpServersActivity(
  input: FetchEnabledMcpServersInput
): Promise<FetchEnabledMcpServersOutput> {
  const baseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);
  const headers = buildHeaders(input.organizationId);

  // Note: We use the /enabled endpoint which returns enabled servers only
  // For full header retrieval in worker context, we'd need an internal endpoint
  // that returns decrypted headers. For now, servers without headers work.
  const response = await fetch(`${baseUrl}/api/v1/mcp-servers/enabled`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const raw = await readErrorBody(response);
    throw new ServiceError(
      `Failed to fetch enabled MCP servers: ${raw}`,
      {
        statusCode: response.status,
        details: { statusText: response.statusText },
      }
    );
  }

  const apiServers = (await response.json()) as McpServerWithHeadersApiResponse[];

  // Transform API response to McpServerConfig
  const servers: McpServerConfig[] = apiServers.map((server) => ({
    id: server.id,
    name: server.name,
    transportType: server.transportType,
    endpoint: server.endpoint,
    command: server.command,
    args: server.args,
    headers: server.headers ?? null,
    enabled: server.enabled,
  }));

  return { servers };
}

/**
 * Activity: Health check a single MCP server.
 *
 * Attempts to connect to the server and list its tools to verify it's responsive.
 */
export async function healthCheckMcpServerActivity(
  input: HealthCheckMcpServerInput
): Promise<HealthCheckMcpServerOutput> {
  const mcpClient = getMcpClientService();
  const result = await mcpClient.healthCheck(input.server);
  return { result };
}

/**
 * Activity: Discover tools from an MCP server.
 *
 * Connects to the server and retrieves the list of available tools
 * along with their schemas.
 */
export async function discoverMcpServerToolsActivity(
  input: DiscoverMcpServerToolsInput
): Promise<DiscoverMcpServerToolsOutput> {
  const mcpClient = getMcpClientService();

  try {
    const tools = await mcpClient.discoverTools(input.server);
    return { tools };
  } catch (error) {
    return {
      tools: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Activity: Batch health check multiple MCP servers.
 *
 * Checks health of all provided servers in parallel and returns results.
 */
export async function batchHealthCheckMcpServersActivity(
  input: BatchHealthCheckInput
): Promise<BatchHealthCheckOutput> {
  const mcpClient = getMcpClientService();

  const results = await Promise.all(
    input.servers.map((server) => mcpClient.healthCheck(server))
  );

  return { results };
}

/**
 * Activity: Report health status back to the backend.
 *
 * Updates the health status of MCP servers in the database.
 */
export async function reportMcpHealthStatusActivity(input: {
  organizationId?: string | null;
  healthResults: McpHealthResult[];
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(DEFAULT_API_BASE_URL);
  const headers = buildHeaders(input.organizationId);

  // Report each health status update
  await Promise.all(
    input.healthResults.map(async (result) => {
      try {
        // We would need an internal endpoint for this
        // For now, just log the status
        console.log(
          `[MCP Health] Server ${result.serverId}: ${result.status}`,
          result.error ? `(${result.error})` : ''
        );
      } catch (error) {
        console.error(
          `[MCP Health] Failed to report status for ${result.serverId}:`,
          error
        );
      }
    })
  );
}
