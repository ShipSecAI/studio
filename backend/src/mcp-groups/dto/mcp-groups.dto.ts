import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ============================================================================
// Base Schemas
// ============================================================================

export const McpGroupSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  credentialContractName: z.string(),
  credentialMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultDockerImage: z.string().nullable().optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type McpGroup = z.infer<typeof McpGroupSchema>;

export const McpGroupServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  enabled: z.boolean(),
  recommended: z.boolean(),
  defaultSelected: z.boolean(),
});

export type McpGroupServer = z.infer<typeof McpGroupServerSchema>;

// ============================================================================
// Request DTOs
// ============================================================================

export const CreateMcpGroupSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  credentialContractName: z.string().min(1),
  credentialMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultDockerImage: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export class CreateMcpGroupDto extends createZodDto(CreateMcpGroupSchema) {}

export const UpdateMcpGroupSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  credentialContractName: z.string().min(1).optional(),
  credentialMapping: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultDockerImage: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export class UpdateMcpGroupDto extends createZodDto(UpdateMcpGroupSchema) {}

export const AddServerToGroupSchema = z.object({
  serverId: z.string().uuid(),
  recommended: z.boolean().optional(),
  defaultSelected: z.boolean().optional(),
});

export class AddServerToGroupDto extends createZodDto(AddServerToGroupSchema) {}

export const UpdateServerInGroupSchema = z.object({
  recommended: z.boolean().optional(),
  defaultSelected: z.boolean().optional(),
});

export class UpdateServerInGroupDto extends createZodDto(UpdateServerInGroupSchema) {}

// ============================================================================
// Response DTOs
// ============================================================================

export const McpGroupResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  credentialContractName: z.string(),
  credentialMapping: z.record(z.string(), z.unknown()).nullable(),
  defaultDockerImage: z.string().nullable(),
  enabled: z.boolean(),
  templateHash: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class McpGroupResponseDto extends createZodDto(McpGroupResponseSchema) {
  static create(
    group: typeof import('../../database/schema').mcpGroups.$inferSelect & {
      templateHash?: string | null;
      _count?: { servers: number } | null;
    },
  ): McpGroupResponseDto {
    return {
      id: group.id,
      slug: group.slug,
      name: group.name,
      description: group.description,
      credentialContractName: group.credentialContractName,
      credentialMapping: group.credentialMapping,
      defaultDockerImage: group.defaultDockerImage,
      enabled: group.enabled,
      templateHash: (group as any).templateHash ?? null,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }
}

export const McpGroupServerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  serverName: z.string(),
  description: z.string().nullable(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().nullable(),
  command: z.string().nullable(),
  enabled: z.boolean(),
  healthStatus: z.enum(['healthy', 'unhealthy', 'unknown']),
  toolCount: z.number(),
  recommended: z.boolean(),
  defaultSelected: z.boolean(),
});

export class McpGroupServerResponseDto extends createZodDto(McpGroupServerResponseSchema) {}

export const SyncTemplatesResponseSchema = z.object({
  syncedCount: z.number(),
  createdCount: z.number(),
  updatedCount: z.number(),
  templates: z.array(z.string()),
});

export class SyncTemplatesResponseDto extends createZodDto(SyncTemplatesResponseSchema) {}

export const ImportGroupTemplateResponseSchema = z.object({
  action: z.enum(['created', 'updated', 'skipped']),
  group: McpGroupResponseSchema,
});

export class ImportGroupTemplateResponseDto extends createZodDto(
  ImportGroupTemplateResponseSchema,
) {}

// DTO for importing a template with optional cache tokens for each server
export const ImportTemplateRequestSchema = z.object({
  // Map of server name -> cacheToken from pre-discovery
  // When provided, tools will be automatically loaded from cache
  serverCacheTokens: z.record(z.string(), z.string()).optional(),
});

export class ImportTemplateRequestDto extends createZodDto(ImportTemplateRequestSchema) {}

export const DiscoverGroupToolsResponseSchema = z.object({
  groupId: z.string(),
  totalServers: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  results: z.array(
    z.object({
      serverId: z.string(),
      serverName: z.string(),
      toolCount: z.number(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});

export class DiscoverGroupToolsResponseDto extends createZodDto(DiscoverGroupToolsResponseSchema) {}

// ============================================================================
// Template DTOs
// ============================================================================

export const GroupTemplateServerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transportType: z.enum(['http', 'stdio', 'sse', 'websocket']),
  endpoint: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  recommended: z.boolean(),
  defaultSelected: z.boolean(),
});

export class GroupTemplateServerDto extends createZodDto(GroupTemplateServerSchema) {}

export const TemplateVersionSchema = z.object({
  major: z.number(),
  minor: z.number(),
  patch: z.number(),
});

export const GroupTemplateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  credentialContractName: z.string().min(1),
  credentialMapping: z.record(z.string(), z.unknown()).optional(),
  defaultDockerImage: z.string().min(1),
  version: TemplateVersionSchema,
  servers: z.array(GroupTemplateServerSchema),
  templateHash: z.string(),
});

export class GroupTemplateDto extends createZodDto(GroupTemplateSchema) {}

// ============================================================================
// Backward Compatibility Exports
// ============================================================================

// Export classes with both names for backward compatibility (as values)
export const McpGroupResponse = McpGroupResponseDto;
export const McpGroupServerResponse = McpGroupServerResponseDto;
export const SyncTemplatesResponse = SyncTemplatesResponseDto;
export const ImportGroupTemplateResponse = ImportGroupTemplateResponseDto;
export const DiscoverGroupToolsResponse = DiscoverGroupToolsResponseDto;

// Type aliases for use in type annotations
export type McpGroupResponse = McpGroupResponseDto;
export type McpGroupServerResponse = McpGroupServerResponseDto;
export type SyncTemplatesResponse = SyncTemplatesResponseDto;
export type ImportGroupTemplateResponse = ImportGroupTemplateResponseDto;
export type DiscoverGroupToolsResponse = DiscoverGroupToolsResponseDto;
