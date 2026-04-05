import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { mcpServers } from '../../database/schema/mcp-servers';

export type TransportType = 'http' | 'stdio';
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';
export type RuntimeType = 'docker' | 'host';

export const CreateMcpServerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transportType: z.enum(['http', 'stdio']),
  endpoint: z.string().url().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  healthCheckUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  groupId: z.string().optional(),
  cacheToken: z.string().optional(),
});

export class CreateMcpServerDto extends createZodDto(CreateMcpServerSchema) {}

export const UpdateMcpServerSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  transportType: z.enum(['http', 'stdio']).optional(),
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
  transportType: z.enum(['http', 'stdio']),
  runtimeType: z.enum(['docker', 'host']),
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
  templateSlug: z.string().nullable(),
  templateHash: z.string().nullable(),
  templateConfig: z.record(z.string(), z.unknown()).nullable(),
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
      runtimeType: ((server as typeof mcpServers.$inferSelect & { runtimeType?: RuntimeType })
        .runtimeType ?? 'docker') as RuntimeType,
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
      templateSlug: (server as any).templateSlug ?? null,
      templateHash: (server as any).templateHash ?? null,
      templateConfig: ((server as any).templateConfig as Record<string, unknown> | null) ?? null,
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

export const GitHubMcpTemplateConfigSchema = z.object({
  installationId: z.number().int().positive(),
  readOnly: z.boolean().optional(),
  toolsets: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  dynamicToolsets: z.boolean().optional(),
  githubHost: z.string().url().optional(),
});

export class GitHubMcpTemplateConfigDto extends createZodDto(GitHubMcpTemplateConfigSchema) {}

export const ImportMcpServerTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  github: GitHubMcpTemplateConfigSchema.optional(),
});

export class ImportMcpServerTemplateDto extends createZodDto(ImportMcpServerTemplateSchema) {}

export const McpServerTemplateSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  transportType: z.enum(['http', 'stdio']),
  runtimeType: z.enum(['docker', 'host']),
  authSource: z.enum(['none', 'github_app']),
  docsUrl: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  supportsReadOnly: z.boolean().optional(),
  supportsDynamicToolsets: z.boolean().optional(),
  availableToolsets: z.array(z.string()).optional(),
  defaultToolsets: z.array(z.string()).optional(),
  defaultTools: z.array(z.string()).optional(),
  importedServerId: z.string().nullable().optional(),
  version: z.object({
    major: z.number(),
    minor: z.number(),
    patch: z.number(),
  }),
});

export class McpServerTemplateDto extends createZodDto(McpServerTemplateSchema) {}

export const ImportMcpServerTemplateResponseSchema = z.object({
  action: z.enum(['created', 'updated']),
  server: McpServerResponseSchema,
});

export class ImportMcpServerTemplateResponseDto extends createZodDto(
  ImportMcpServerTemplateResponseSchema,
) {}

export const ResolvedMcpConfigSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  args: z.array(z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});

export class ResolvedMcpConfigDto extends createZodDto(ResolvedMcpConfigSchema) {}

// Export classes with both names for backward compatibility (as values)
export const McpServerResponse = McpServerResponseDto;
export const McpToolResponse = McpToolResponseDto;
export const TestConnectionResponse = TestConnectionResponseDto;
export const HealthStatusResponse = HealthStatusResponseDto;
export const McpServerTemplateResponse = McpServerTemplateDto;
export const ImportMcpServerTemplateResponse = ImportMcpServerTemplateResponseDto;
export const ResolvedMcpConfigResponse = ResolvedMcpConfigDto;

// Type aliases for use in type annotations
export type McpServerResponse = McpServerResponseDto;
export type McpToolResponse = McpToolResponseDto;
export type TestConnectionResponse = TestConnectionResponseDto;
export type HealthStatusResponse = HealthStatusResponseDto;
export type McpServerTemplateResponse = McpServerTemplateDto;
export type ImportMcpServerTemplateResponse = ImportMcpServerTemplateResponseDto;
export type ResolvedMcpConfigResponse = ResolvedMcpConfigDto;
