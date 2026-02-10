import { ToolInputSchema } from '@shipsec/component-sdk';

/**
 * Tool discovered from an MCP server.
 * Matches the MCP protocol's tools/list response.
 */
export class McpToolDefinition {
  name!: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Input for registering an MCP server proxy.
 * This registers the *server* as a tool source with pre-discovered tools.
 */
export class RegisterMcpServerInput {
  runId!: string;
  /** The node ID in the workflow graph (e.g., 'mcp-library' or 'aws-mcp-group/cloudtrail') */
  nodeId!: string;
  /** Human-readable server name (e.g., 'AWS CloudTrail') */
  serverName!: string;
  /** Optional: MCP server ID from the database (for pre-configured servers) */
  serverId?: string;
  /** Transport type */
  transport!: 'http' | 'stdio';
  /** The HTTP endpoint to proxy requests to */
  endpoint!: string;
  /** For stdio servers, the container ID for cleanup */
  containerId?: string;
  /** Headers to pass when connecting to the server (e.g., auth tokens) */
  headers?: Record<string, string>;
  /**
   * Pre-discovered tools from the server.
   * If provided, the gateway can use these immediately instead of discovering on first connection.
   */
  tools?: McpToolDefinition[];
}

/**
 * Input for registering a component tool
 */
export class RegisterComponentToolInput {
  runId!: string;
  nodeId!: string;
  toolName!: string;
  /**
   * Whether this tool should be exposed to AI agents via the MCP gateway.
   * Some nodes run in tool-mode for dependency readiness only (e.g. MCP group providers).
   *
   * Defaults to true for backwards compatibility.
   */
  exposedToAgent?: boolean;
  componentId!: string;
  description!: string;
  inputSchema!: ToolInputSchema;
  credentials!: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  providerKind?: 'component' | 'mcp-server' | 'mcp-group';
}
