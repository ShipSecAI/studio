import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Base schemas
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

// DTOs
export class CreateMcpGroupDto {
  @ApiProperty({ description: 'URL-friendly slug for the group' })
  slug!: string;

  @ApiProperty({ description: 'Human-readable name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Description of the group' })
  description?: string | null;

  @ApiProperty({ description: 'Credential contract name for authentication' })
  credentialContractName!: string;

  @ApiPropertyOptional({ description: 'Mapping of credentials for servers in this group' })
  credentialMapping?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Default Docker image for servers in this group' })
  defaultDockerImage?: string | null;

  @ApiPropertyOptional({ description: 'Whether the group is enabled' })
  enabled?: boolean;
}

export class UpdateMcpGroupDto {
  @ApiPropertyOptional({ description: 'Human-readable name' })
  name?: string;

  @ApiPropertyOptional({ description: 'Description of the group' })
  description?: string | null;

  @ApiPropertyOptional({ description: 'Credential contract name for authentication' })
  credentialContractName?: string;

  @ApiPropertyOptional({ description: 'Mapping of credentials for servers in this group' })
  credentialMapping?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Default Docker image for servers in this group' })
  defaultDockerImage?: string | null;

  @ApiPropertyOptional({ description: 'Whether the group is enabled' })
  enabled?: boolean;
}

export class McpGroupResponse {
  @ApiProperty({ description: 'Group ID' })
  id!: string;

  @ApiProperty({ description: 'URL-friendly slug' })
  slug!: string;

  @ApiProperty({ description: 'Group name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Group description' })
  description!: string | null;

  @ApiProperty({ description: 'Credential contract name' })
  credentialContractName!: string;

  @ApiPropertyOptional({ description: 'Credential mapping' })
  credentialMapping!: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Default Docker image' })
  defaultDockerImage!: string | null;

  @ApiProperty({ description: 'Whether group is enabled' })
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Template hash for seeded groups' })
  templateHash?: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;
}

export class McpGroupServerResponse {
  @ApiProperty({ description: 'Server ID' })
  id!: string;

  @ApiProperty({ description: 'Server name (display name)' })
  name!: string;

  @ApiProperty({ description: 'Server name (alias for frontend)' })
  serverName!: string;

  @ApiPropertyOptional({ description: 'Server description' })
  description!: string | null;

  @ApiProperty({ description: 'Transport type', enum: ['http', 'stdio', 'sse', 'websocket'] })
  transportType!: string;

  @ApiPropertyOptional({ description: 'HTTP endpoint URL' })
  endpoint!: string | null;

  @ApiPropertyOptional({ description: 'Command for stdio transport' })
  command!: string | null;

  @ApiProperty({ description: 'Whether server is enabled' })
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Health status' })
  healthStatus!: 'healthy' | 'unhealthy' | 'unknown';

  @ApiProperty({ description: 'Number of tools available' })
  toolCount!: number;

  @ApiProperty({ description: 'Whether server is recommended for this group' })
  recommended!: boolean;

  @ApiProperty({ description: 'Whether server is selected by default' })
  defaultSelected!: boolean;
}

export class AddServerToGroupDto {
  @ApiProperty({ description: 'Server ID to add to group' })
  serverId!: string;

  @ApiPropertyOptional({ description: 'Whether this server is recommended' })
  recommended?: boolean;

  @ApiPropertyOptional({ description: 'Whether this server is selected by default' })
  defaultSelected?: boolean;
}

export class UpdateServerInGroupDto {
  @ApiPropertyOptional({ description: 'Whether this server is recommended' })
  recommended?: boolean;

  @ApiPropertyOptional({ description: 'Whether this server is selected by default' })
  defaultSelected?: boolean;
}

export class SyncTemplatesResponse {
  @ApiProperty({ description: 'Number of templates synced' })
  syncedCount!: number;

  @ApiProperty({ description: 'Number of templates created' })
  createdCount!: number;

  @ApiProperty({ description: 'Number of templates updated' })
  updatedCount!: number;

  @ApiProperty({ description: 'Template slugs that were synced' })
  templates!: string[];
}

export class DiscoverGroupToolsResponse {
  @ApiProperty({ description: 'Group ID' })
  groupId!: string;

  @ApiProperty({ description: 'Total servers processed' })
  totalServers!: number;

  @ApiProperty({ description: 'Servers where tools were discovered successfully' })
  successCount!: number;

  @ApiProperty({ description: 'Servers where discovery failed' })
  failureCount!: number;

  @ApiProperty({ description: 'Per-server results' })
  results!: {
    serverId: string;
    serverName: string;
    toolCount: number;
    success: boolean;
    error?: string;
  }[];
}

/**
 * DTO for server within a group template
 */
export class GroupTemplateServerDto {
  @ApiProperty({ description: 'Server name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Server description' })
  description?: string;

  @ApiProperty({
    description: 'Transport type',
    enum: ['http', 'stdio', 'sse', 'websocket'],
  })
  transportType!: 'http' | 'stdio' | 'sse' | 'websocket';

  @ApiPropertyOptional({ description: 'URL endpoint' })
  endpoint?: string;

  @ApiPropertyOptional({ description: 'Command for stdio transport' })
  command?: string;

  @ApiPropertyOptional({ description: 'Command arguments', type: [String] })
  args?: string[];

  @ApiProperty({ description: 'Whether recommended' })
  recommended!: boolean;

  @ApiProperty({ description: 'Whether selected by default' })
  defaultSelected!: boolean;
}

/**
 * DTO for group template representation
 */
export class GroupTemplateDto {
  @ApiProperty({ description: 'Template slug (unique identifier)' })
  slug!: string;

  @ApiProperty({ description: 'Template name' })
  name!: string;

  @ApiPropertyOptional({ description: 'Template description' })
  description?: string;

  @ApiProperty({ description: 'Required credential contract name' })
  credentialContractName!: string;

  @ApiPropertyOptional({ description: 'Credential field mapping' })
  credentialMapping?: Record<string, unknown>;

  @ApiProperty({ description: 'Default Docker image' })
  defaultDockerImage!: string;

  @ApiProperty({
    description: 'Template version',
    type: 'object',
    properties: {
      major: { type: 'number' },
      minor: { type: 'number' },
      patch: { type: 'number' },
    },
  })
  version!: {
    major: number;
    minor: number;
    patch: number;
  };

  @ApiProperty({ description: 'Servers in this template', type: [GroupTemplateServerDto] })
  servers!: GroupTemplateServerDto[];

  @ApiProperty({ description: 'Deterministic hash for change detection' })
  templateHash!: string;
}
