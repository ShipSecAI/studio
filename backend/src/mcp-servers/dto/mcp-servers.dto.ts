import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { mcpServers } from '../../database/schema/mcp-servers';

export type TransportType = 'http' | 'stdio' | 'sse' | 'websocket';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export const CreateMcpServerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().url().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  healthCheckUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  groupId: z.string().optional(),
});

export class CreateMcpServerDto extends createZodDto(CreateMcpServerSchema) {}

export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']).optional(),
  endpoint: z.string().url().nullable().optional(),
  command: z.string().min(1).nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  healthCheckUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
});

export class UpdateMcpServerDto extends createZodDto(UpdateMcpServerSchema) {}

export const McpServerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().nullable(),
  command: z.string().nullable(),
  args: z.array(z.string()).nullable(),
  hasHeaders: z.boolean(),
  headerKeys: z.array(z.string()).nullable(),
  enabled: z.boolean(),
  healthCheckUrl: z.string().nullable(),
  lastHealthCheck: z.string().datetime().nullable(),
  lastHealthStatus: z.enum(['healthy', 'unhealthy', 'unknown']).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  groupId: z.string().nullable(),
});

export class McpServerResponseDto extends createZodDto(McpServerResponseSchema) {
  static create(
    server: typeof mcpServers.$inferSelect,
    headerKeys?: string[] | null,
  ): McpServerResponseDto {
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      transportType: server.transportType as TransportType,
      endpoint: server.endpoint,
      command: server.command,
      args: server.args,
      hasHeaders: server.headers !== null,
      headerKeys: headerKeys ?? null,
      enabled: server.enabled,
      healthCheckUrl: server.healthCheckUrl,
      lastHealthCheck: server.lastHealthCheck?.toISOString() ?? null,
      lastHealthStatus: (server.lastHealthStatus as HealthStatus | null | undefined) ?? null,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
      groupId: server.groupId ?? null,
    };
  }
}

export const McpToolResponseSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  description: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()).nullable(),
  serverId: z.string(),
  serverName: z.string(),
  enabled: z.boolean(),
  discoveredAt: z.string().datetime(),
});

export class McpToolResponseDto extends createZodDto(McpToolResponseSchema) {
  static create(
    tool: typeof import('../../database/schema').mcpServerTools.$inferSelect & {
      serverName?: string;
    },
    serverName?: string,
  ): McpToolResponseDto {
    return {
      id: tool.id,
      toolName: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      serverId: tool.serverId,
      serverName: tool.serverName ?? serverName ?? 'Unknown',
      enabled: tool.enabled,
      discoveredAt: tool.discoveredAt.toISOString(),
    };
  }
}

export const TestConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  toolCount: z.number().optional(),
  protocolVersion: z.string().optional(),
  responseTimeMs: z.number().optional(),
});

export class TestConnectionResponseDto extends createZodDto(TestConnectionResponseSchema) {}

export const HealthStatusResponseSchema = z.object({
  serverId: z.string(),
  status: z.enum(['healthy', 'unhealthy', 'unknown']),
  checkedAt: z.string().datetime().nullable(),
});

export class HealthStatusResponseDto extends createZodDto(HealthStatusResponseSchema) {}

// Export classes with both names for backward compatibility (as values)
export const McpServerResponse = McpServerResponseDto;
export const McpToolResponse = McpToolResponseDto;
export const TestConnectionResponse = TestConnectionResponseDto;
export const HealthStatusResponse = HealthStatusResponseDto;

// Type aliases for use in type annotations
export type McpServerResponse = McpServerResponseDto;
export type McpToolResponse = McpToolResponseDto;
export type TestConnectionResponse = TestConnectionResponseDto;
export type HealthStatusResponse = HealthStatusResponseDto;
