import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpGroupsRepository, type McpGroupUpdateData } from './mcp-groups.repository';
import { McpGroupsSeedingService } from './mcp-groups-seeding.service';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import type {
  CreateMcpGroupDto,
  UpdateMcpGroupDto,
  McpGroupResponse,
  McpGroupServerResponse,
  AddServerToGroupDto,
  UpdateServerInGroupDto,
  SyncTemplatesResponse,
  DiscoverGroupToolsResponse,
  GroupTemplateDto,
  ImportGroupTemplateResponse,
} from './mcp-groups.dto';
import type { McpGroupRecord } from '../database/schema';
import type { TemplateSyncResult } from './mcp-groups-seeding.service';

@Injectable()
export class McpGroupsService implements OnModuleInit {
  private readonly logger = new Logger(McpGroupsService.name);

  constructor(
    private readonly repository: McpGroupsRepository,
    private readonly seedingService: McpGroupsSeedingService,
    private readonly mcpServersRepository: McpServersRepository,
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

  async importTemplate(slug: string): Promise<ImportGroupTemplateResponse> {
    const result: TemplateSyncResult = await this.seedingService.syncTemplate(slug);
    const group = await this.getGroupBySlug(slug);

    return {
      action: result.action,
      group,
    };
  }

  async createGroup(input: CreateMcpGroupDto): Promise<McpGroupResponse> {
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

    return this.mapGroupToResponse(group);
  }

  async updateGroup(id: string, input: UpdateMcpGroupDto): Promise<McpGroupResponse> {
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
    return this.mapGroupToResponse(group);
  }

  async deleteGroup(id: string): Promise<void> {
    // Verify group exists and collect servers to clean up
    await this.repository.findById(id);
    const servers = await this.repository.findServersByGroup(id);

    for (const server of servers) {
      // Remove group relation first
      await this.repository.removeServerFromGroup(id, server.id);
      // Clear tools and delete the server itself
      await this.mcpServersRepository.clearTools(server.id);
      await this.mcpServersRepository.delete(server.id);
    }

    await this.repository.delete(id);
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

  async discoverGroupTools(groupId: string): Promise<DiscoverGroupToolsResponse> {
    const group = await this.repository.findById(groupId);

    if (!group.defaultDockerImage) {
      throw new BadRequestException('Group has no default Docker image configured');
    }

    const servers = await this.repository.findServersByGroup(groupId);
    const enabledServers = servers.filter((server) => server.enabled);

    const exec = promisify(execFile);
    const results: DiscoverGroupToolsResponse['results'] = [];

    for (const server of enabledServers) {
      if (!server.command) {
        results.push({
          serverId: server.id,
          serverName: server.name,
          toolCount: 0,
          success: false,
          error: 'Server has no command configured',
        });
        continue;
      }

      const containerName = `mcp-discovery-${group.slug}-${server.name}-${Date.now()}`;
      const argsValue = server.args ? JSON.stringify(server.args) : '';
      const envArgs = ['MCP_COMMAND=' + server.command];
      if (argsValue) {
        envArgs.push('MCP_ARGS=' + argsValue);
      }

      if (group.slug === 'aws') {
        envArgs.push('AWS_ACCESS_KEY_ID=test');
        envArgs.push('AWS_SECRET_ACCESS_KEY=test');
        envArgs.push('AWS_REGION=us-east-1');
      }

      const runContainer = async (image: string): Promise<string> => {
        await exec('docker', [
          'run',
          '-d',
          '--rm',
          '--name',
          containerName,
          ...envArgs.flatMap((entry) => ['-e', entry]),
          '-p',
          '0:8080',
          image,
        ]);

        const { stdout: portOutput } = await exec('docker', ['port', containerName, '8080']);
        const match = portOutput.match(/:(\d+)\s*$/m);
        if (!match) {
          throw new Error(`Failed to read mapped port for ${server.name}`);
        }
        return match[1];
      };

      try {
        const imagesToTry = [group.defaultDockerImage];
        if (group.slug === 'aws' && group.defaultDockerImage !== 'docker-aws-suite') {
          imagesToTry.push('docker-aws-suite');
        }

        let port: string | null = null;
        let lastError: Error | null = null;

        for (const image of imagesToTry) {
          try {
            port = await runContainer(image);
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Docker run failed');
            try {
              await exec('docker', ['rm', '-f', containerName]);
            } catch {
              // ignore cleanup errors
            }
          }
        }

        if (!port) {
          throw lastError ?? new Error('Failed to start discovery container');
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));

        const response = await fetch(`http://localhost:${port}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} when listing tools`);
        }

        const data = (await response.json()) as {
          result?: {
            tools?: {
              name: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
            }[];
          };
        };

        const tools = data.result?.tools ?? [];
        const toolRecords = tools.map((tool) => ({
          toolName: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? null,
        }));

        await this.mcpServersRepository.upsertTools(server.id, toolRecords);
        await this.mcpServersRepository.updateHealthStatus(server.id, 'healthy');

        results.push({
          serverId: server.id,
          serverName: server.name,
          toolCount: toolRecords.length,
          success: true,
        });
      } catch (error) {
        results.push({
          serverId: server.id,
          serverName: server.name,
          toolCount: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        try {
          await exec('docker', ['rm', '-f', containerName]);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return {
      groupId,
      totalServers: results.length,
      successCount,
      failureCount,
      results,
    };
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
}
