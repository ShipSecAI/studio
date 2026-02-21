import {
  Injectable,
  Logger,
  BadRequestException,
  OnModuleInit,
  Inject,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';

import { McpGroupsRepository, type McpGroupUpdateData } from './mcp-groups.repository';
import { McpGroupsSeedingService } from './mcp-groups-seeding.service';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthContext } from '../auth/types';
import type {
  CreateMcpGroupDto,
  UpdateMcpGroupDto,
  McpGroupResponse,
  McpGroupServerResponse,
  AddServerToGroupDto,
  UpdateServerInGroupDto,
  SyncTemplatesResponse,
  GroupTemplateDto,
  ImportTemplateRequestDto,
  ImportGroupTemplateResponse,
} from './dto/mcp-groups.dto';
import type { McpGroupRecord } from '../database/schema';
import type { TemplateSyncResult } from './mcp-groups-seeding.service';

// Redis injection token - must match the one in mcp-servers.service.ts
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Injectable()
export class McpGroupsService implements OnModuleInit {
  private readonly logger = new Logger(McpGroupsService.name);

  constructor(
    private readonly repository: McpGroupsRepository,
    private readonly seedingService: McpGroupsSeedingService,
    private readonly mcpServersRepository: McpServersRepository,
    @Optional() @Inject(MCP_SERVERS_REDIS) private readonly redis: Redis | null,
    private readonly auditLogService: AuditLogService,
  ) {}

  async onModuleInit() {
    if (process.env.MCP_SYNC_TEMPLATES_ON_STARTUP !== 'true') {
      return;
    }

    try {
      await this.seedingService.syncAllTemplates();
      this.logger.log('MCP group templates synced on startup.');
    } catch (error) {
      this.logger.error('Failed to sync MCP group templates on startup', error);
    }
  }

  private mapGroupToResponse(record: McpGroupRecord): McpGroupResponse {
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      description: record.description,
      credentialContractName: record.credentialContractName,
      credentialMapping: record.credentialMapping,
      defaultDockerImage: record.defaultDockerImage,
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private mapGroupServerToResponse(
    record: ReturnType<typeof this.repository.findServersByGroup> extends Promise<infer T>
      ? T extends (infer R)[]
        ? R
        : never
      : never,
  ): McpGroupServerResponse {
    const transportType =
      (record as any).transportType ?? (record as any).transport_type ?? record.transportType;
    const toolCount = (record as any).toolCount ?? (record as any).tool_count ?? 0;
    const healthStatus =
      (record as any).lastHealthStatus ??
      (record as any).last_health_status ??
      record.lastHealthStatus ??
      'unknown';

    return {
      id: record.id,
      serverName: record.name,
      name: record.name, // Keep for backwards compatibility
      description: record.description,
      transportType: transportType as 'http' | 'stdio' | 'sse' | 'websocket',
      endpoint: record.endpoint,
      command: record.command,
      args: (record as any).args ?? null,
      enabled: record.enabled,
      healthStatus: healthStatus as 'healthy' | 'unhealthy' | 'unknown',
      toolCount,
      recommended: record.recommended,
      defaultSelected: record.defaultSelected,
    };
  }

  async listGroups(enabledOnly = false): Promise<McpGroupResponse[]> {
    const groups = await this.repository.findAll(enabledOnly ? { enabled: true } : {});
    return groups.map((g) => this.mapGroupToResponse(g));
  }

  async listGroupsWithServers(
    enabledOnly = false,
  ): Promise<(McpGroupResponse & { servers: McpGroupServerResponse[] })[]> {
    const [groups, serversMap] = await Promise.all([
      this.repository.findAll(enabledOnly ? { enabled: true } : {}),
      this.repository.findAllServersGrouped(),
    ]);
    return groups.map((g) => ({
      ...this.mapGroupToResponse(g),
      servers: (serversMap.get(g.id) ?? []).map((s) => this.mapGroupServerToResponse(s)),
    }));
  }

  listTemplates(): GroupTemplateDto[] {
    return this.seedingService.getAllTemplates();
  }

  async getGroup(id: string): Promise<McpGroupResponse> {
    const group = await this.repository.findById(id);
    return this.mapGroupToResponse(group);
  }

  async getGroupBySlug(slug: string): Promise<McpGroupResponse> {
    const group = await this.repository.findBySlug(slug);
    if (!group) {
      throw new BadRequestException(`MCP group with slug '${slug}' not found`);
    }
    return this.mapGroupToResponse(group);
  }

  async importTemplate(
    slug: string,
    organizationId: string,
    input?: ImportTemplateRequestDto,
    auth?: AuthContext | null,
  ): Promise<ImportGroupTemplateResponse> {
    const result: TemplateSyncResult = await this.seedingService.syncTemplate(
      slug,
      false,
      organizationId,
    );
    const group = await this.getGroupBySlug(slug);

    // If cache tokens were provided, create tools for each server
    if (input?.serverCacheTokens && Object.keys(input.serverCacheTokens).length > 0) {
      this.logger.log(
        `Processing ${Object.keys(input.serverCacheTokens).length} cache tokens for group '${slug}'`,
      );

      // Get all servers in the group
      const servers = await this.repository.findServersByGroup(group.id);

      // Create tools for each server that has a cache token
      for (const server of servers) {
        const cacheToken = input.serverCacheTokens[server.name];
        if (cacheToken) {
          try {
            // Load tools from discovery cache (same logic as createServer in McpServersService)
            const cached = await this.getCachedDiscovery(cacheToken);
            if (cached && cached.tools.length > 0) {
              this.logger.log(
                `Loading ${cached.tools.length} tools for server '${server.name}' from cache`,
              );
              await this.mcpServersRepository.upsertTools(
                server.id,
                cached.tools.map((tool: any) => ({
                  toolName: tool.name,
                  description: tool.description ?? null,
                  inputSchema: tool.inputSchema ?? null,
                })),
              );
            }
            if (cached) {
              // Mark server healthy when discovery completed (even if tool count is 0)
              await this.mcpServersRepository.updateHealthStatus(server.id, 'healthy', {});
            }
          } catch (error) {
            this.logger.warn(`Failed to load cached tools for server '${server.name}':`, error);
          }
        }
      }
    }

    this.auditLogService.record(auth ?? null, {
      action: 'mcp_group.import_template',
      resourceType: 'mcp_group',
      resourceId: group.id,
      resourceName: group.name,
      metadata: { slug, action: result.action },
    });

    return {
      action: result.action,
      group,
    };
  }

  async createGroup(auth: AuthContext | null, input: CreateMcpGroupDto): Promise<McpGroupResponse> {
    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(input.slug)) {
      throw new BadRequestException(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      );
    }

    const group = await this.repository.create({
      slug: input.slug.trim(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      credentialContractName: input.credentialContractName.trim(),
      credentialMapping: input.credentialMapping ?? null,
      defaultDockerImage: input.defaultDockerImage?.trim() || null,
      enabled: input.enabled ?? true,
    });

    this.auditLogService.record(auth, {
      action: 'mcp_group.create',
      resourceType: 'mcp_group',
      resourceId: group.id,
      resourceName: group.name,
      metadata: { slug: group.slug },
    });

    return this.mapGroupToResponse(group);
  }

  async updateGroup(
    auth: AuthContext | null,
    id: string,
    input: UpdateMcpGroupDto,
  ): Promise<McpGroupResponse> {
    const updates: McpGroupUpdateData = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Group name cannot be empty');
      }
      updates.name = trimmed;
    }

    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }

    if (input.credentialContractName !== undefined) {
      updates.credentialContractName = input.credentialContractName.trim();
    }

    if (input.credentialMapping !== undefined) {
      updates.credentialMapping = input.credentialMapping;
    }

    if (input.defaultDockerImage !== undefined) {
      updates.defaultDockerImage = input.defaultDockerImage?.trim() || null;
    }

    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    if (Object.keys(updates).length === 0) {
      const current = await this.repository.findById(id);
      return this.mapGroupToResponse(current);
    }

    const group = await this.repository.update(id, updates);

    this.auditLogService.record(auth, {
      action: 'mcp_group.update',
      resourceType: 'mcp_group',
      resourceId: group.id,
      resourceName: group.name,
      metadata: { slug: group.slug },
    });

    return this.mapGroupToResponse(group);
  }

  async deleteGroup(auth: AuthContext | null, id: string): Promise<void> {
    // Verify group exists and collect servers to clean up
    const group = await this.repository.findById(id);
    const servers = await this.repository.findServersByGroup(id);

    for (const server of servers) {
      // Remove group relation first
      await this.repository.removeServerFromGroup(id, server.id);
      // Clear tools and delete the server itself
      await this.mcpServersRepository.clearTools(server.id);
      await this.mcpServersRepository.delete(server.id);
    }

    await this.repository.delete(id);

    this.auditLogService.record(auth, {
      action: 'mcp_group.delete',
      resourceType: 'mcp_group',
      resourceId: group.id,
      resourceName: group.name,
      metadata: { slug: group.slug, serverCount: servers.length },
    });
  }

  // Group-Server relationship methods

  async getServersInGroup(id: string): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    await this.repository.findById(id);

    const servers = await this.repository.findServersByGroup(id);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  async addServerToGroup(
    groupId: string,
    input: AddServerToGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    await this.repository.findById(groupId);

    await this.repository.addServerToGroup(groupId, input.serverId, {
      recommended: input.recommended,
      defaultSelected: input.defaultSelected,
    });

    // Return updated list of servers
    const servers = await this.repository.findServersByGroup(groupId);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  async removeServerFromGroup(groupId: string, serverId: string): Promise<void> {
    // Verify group exists
    await this.repository.findById(groupId);

    await this.repository.removeServerFromGroup(groupId, serverId);
  }

  async updateServerInGroup(
    groupId: string,
    serverId: string,
    input: UpdateServerInGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    // Verify group exists
    await this.repository.findById(groupId);

    const updates: { recommended?: boolean; defaultSelected?: boolean } = {};
    if (input.recommended !== undefined) {
      updates.recommended = input.recommended;
    }
    if (input.defaultSelected !== undefined) {
      updates.defaultSelected = input.defaultSelected;
    }

    if (Object.keys(updates).length > 0) {
      await this.repository.updateServerMetadata(groupId, serverId, updates);
    }

    // Return updated list of servers
    const servers = await this.repository.findServersByGroup(groupId);
    return servers.map((s) => this.mapGroupServerToResponse(s));
  }

  /**
   * Sync templates from code to database.
   * This is an admin-only operation that creates/updates group templates.
   */
  async syncTemplates(): Promise<SyncTemplatesResponse> {
    this.logger.log('Syncing MCP group templates from code...');

    // Use the seeding service to sync all templates
    const result = await this.seedingService.syncAllTemplates();

    this.logger.log(
      `Template sync complete: ${result.createdCount} created, ${result.updatedCount} updated`,
    );

    return result;
  }

  /**
   * Get cached discovery results from Redis
   * Shared with McpServersService to load tools from cache
   */
  private async getCachedDiscovery(cacheToken: string): Promise<{
    tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
    toolCount: number;
  } | null> {
    if (!this.redis) {
      return null;
    }
    const key = `mcp-discovery:${cacheToken}`;
    const value = await this.redis.get(key);
    if (!value) {
      return null;
    }
    const cached = JSON.parse(value);
    if (cached.status !== 'completed') {
      return null;
    }
    return {
      tools: cached.tools,
      toolCount: cached.toolCount,
    };
  }

  /**
   * Get server configuration for a group template server
   * Used by MCP group runtime to fetch server details
   */
  async getServerConfig(
    groupSlug: string,
    serverId: string,
  ): Promise<{ command: string; args?: string[]; endpoint?: string }> {
    const template = this.seedingService.getTemplateBySlug(groupSlug);
    if (!template) {
      throw new BadRequestException(`MCP group template '${groupSlug}' not found`);
    }

    // Search for server by ID (primary) or name (fallback)
    const server = template.servers.find((s: any) => s.id === serverId || s.name === serverId);
    if (!server) {
      throw new BadRequestException(`Server '${serverId}' not found in group '${groupSlug}'`);
    }

    // Return server configuration
    const config: { command: string; args?: string[]; endpoint?: string } = {
      command: server.command || '',
    };

    if (server.args && server.args.length > 0) {
      config.args = server.args;
    }

    if (server.endpoint) {
      config.endpoint = server.endpoint;
    }

    return config;
  }
}
