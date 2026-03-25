import { ToolInputSchema } from '@shipsec/component-sdk';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GenerateMcpTokenRequestSchema = z.object({
  runId: z.string().min(1),
  organizationId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1).optional(),
  allowedNodeIds: z.array(z.string().min(1)).optional(),
});

export class GenerateMcpTokenRequestDto extends createZodDto(GenerateMcpTokenRequestSchema) {}

export const GenerateMcpTokenResponseSchema = z.object({
  token: z.string(),
});

export class GenerateMcpTokenResponseDto extends createZodDto(GenerateMcpTokenResponseSchema) {}

export const CleanupRunRequestSchema = z.object({
  runId: z.string().min(1),
});

export class CleanupRunRequestDto extends createZodDto(CleanupRunRequestSchema) {}

export const CleanupRunResponseSchema = z.object({
  sessionIds: z.array(z.string()),
});

export class CleanupRunResponseDto extends createZodDto(CleanupRunResponseSchema) {}

export const ToolsReadyRequestSchema = z.object({
  runId: z.string().min(1),
  requiredNodeIds: z.array(z.string().min(1)),
});

export class ToolsReadyRequestDto extends createZodDto(ToolsReadyRequestSchema) {}

export const ToolsReadyResponseSchema = z.object({
  ready: z.boolean(),
});

export class ToolsReadyResponseDto extends createZodDto(ToolsReadyResponseSchema) {}

export const RegisterGroupServerRequestSchema = z.object({
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  groupSlug: z.string().min(1),
  serverId: z.string().min(1),
});

export class RegisterGroupServerRequestDto extends createZodDto(RegisterGroupServerRequestSchema) {}

export const RegisterGroupServerResponseSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  endpoint: z.string().optional(),
});

export class RegisterGroupServerResponseDto extends createZodDto(
  RegisterGroupServerResponseSchema,
) {}

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
  /** Hotplug session ID for cleanup */
  sessionId?: string;
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
  /** Fixed inputs resolved from workflow DAG */
  preparedInputs?: Record<string, unknown>;
  /** Fixed parameters resolved from workflow DAG */
  preparedParams?: Record<string, unknown>;
}

export const RegisterComponentResponseSchema = z.object({
  success: z.boolean(),
});
export class RegisterComponentResponseDto extends createZodDto(RegisterComponentResponseSchema) {}

export const RegisterMcpServerResponseSchema = z.object({
  success: z.boolean(),
  toolCount: z.number(),
});
export class RegisterMcpServerResponseDto extends createZodDto(RegisterMcpServerResponseSchema) {}
