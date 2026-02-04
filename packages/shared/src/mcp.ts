import { z } from 'zod';

// Transport types for MCP server connections
export const McpTransportTypeSchema = z.enum(['http', 'stdio']);
export type McpTransportType = z.infer<typeof McpTransportTypeSchema>;

// Health status for MCP servers
export const McpHealthStatusSchema = z.enum(['healthy', 'unhealthy', 'unknown']);
export type McpHealthStatus = z.infer<typeof McpHealthStatusSchema>;

// Encrypted data structure (matching integrations pattern)
export const EncryptedDataSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  keyId: z.string(),
});
export type EncryptedData = z.infer<typeof EncryptedDataSchema>;

// MCP Server configuration schema
export const McpServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  transportType: McpTransportTypeSchema,
  endpoint: z.string().nullable(), // URL for http/sse/websocket
  command: z.string().nullable(), // Command for stdio transport
  args: z.array(z.string()).nullable(), // Args for stdio command
  hasHeaders: z.boolean(), // Whether encrypted headers are configured
  enabled: z.boolean(),
  healthCheckUrl: z.string().nullable(), // Optional custom health endpoint
  lastHealthCheck: z.string().datetime().nullable(),
  lastHealthStatus: McpHealthStatusSchema.nullable(),
  organizationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

// MCP Tool argument schema (for tool discovery)
export const McpToolArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).default('string'),
  required: z.boolean().default(true),
});
export type McpToolArgument = z.infer<typeof McpToolArgumentSchema>;

// MCP Tool schema (discovered from server)
export const McpToolSchema = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1),
  description: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
  serverId: z.string().uuid(),
  serverName: z.string(),
  enabled: z.boolean(),
  discoveredAt: z.string().datetime(),
});
export type McpTool = z.infer<typeof McpToolSchema>;

// Create MCP Server input schema
export const CreateMcpServerSchema = z
  .object({
    name: z.string().min(1).max(191),
    description: z.string().optional(),
    transportType: McpTransportTypeSchema,
    endpoint: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(), // Plain headers (will be encrypted)
    healthCheckUrl: z.string().url().optional(),
    enabled: z.boolean().default(true),
    cacheToken: z.string().optional(), // Used to auto-create tools from cached discovery results
  })
  .refine(
    (data) => {
      // HTTP requires endpoint
      if (data.transportType === 'http') {
        return !!data.endpoint;
      }
      // stdio requires command
      if (data.transportType === 'stdio') {
        return !!data.command;
      }
      return true;
    },
    {
      message: 'HTTP transport requires endpoint, stdio requires command',
    },
  );
export type CreateMcpServer = z.infer<typeof CreateMcpServerSchema>;

// Update MCP Server input schema
export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).max(191).optional(),
  description: z.string().nullable().optional(),
  transportType: McpTransportTypeSchema.optional(),
  endpoint: z.string().url().nullable().optional(),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  healthCheckUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
});
export type UpdateMcpServer = z.infer<typeof UpdateMcpServerSchema>;

// Health check result schema
export const McpHealthCheckResultSchema = z.object({
  serverId: z.string().uuid(),
  status: McpHealthStatusSchema,
  checkedAt: z.string().datetime(),
  error: z.string().optional(),
  toolCount: z.number().int().nonnegative().optional(),
});
export type McpHealthCheckResult = z.infer<typeof McpHealthCheckResultSchema>;

// SSE health event schema
export const McpHealthEventSchema = z.object({
  type: z.enum(['health_update', 'initial_state', 'server_added', 'server_removed']),
  servers: z.array(
    z.object({
      serverId: z.string().uuid(),
      status: McpHealthStatusSchema,
      checkedAt: z.string().datetime().nullable(),
    }),
  ),
  timestamp: z.string().datetime(),
});
export type McpHealthEvent = z.infer<typeof McpHealthEventSchema>;
