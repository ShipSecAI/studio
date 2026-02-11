import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Inject } from '@nestjs/common';
import { mcpGroups, mcpGroupServers, mcpServers } from '../database/schema';
import { McpGroupsRepository } from './mcp-groups.repository';
import {
  MCP_GROUP_TEMPLATES,
  computeTemplateHash,
  type McpGroupTemplate,
} from './mcp-group-templates';
import { SyncTemplatesResponse, GroupTemplateDto } from './dto/mcp-groups.dto';

/**
 * Result of syncing a single template
 */
export interface TemplateSyncResult {
  slug: string;
  action: 'created' | 'updated' | 'skipped';
  groupId?: string;
  serversSynced: number;
  templateHash: string;
}

/**
 * Service for seeding MCP group templates into the database
 *
 * This service provides functionality to sync template definitions from code
 * to the database. It handles:
 * - Creating new groups from templates
 * - Updating existing groups when templates change
 * - Detecting template changes using deterministic hashing
 * - Managing server entries and relationships
 */
@Injectable()
export class McpGroupsSeedingService {
  private readonly logger = new Logger(McpGroupsSeedingService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
    private readonly groupsRepository: McpGroupsRepository,
  ) {}

  /**
   * Get all available templates as DTOs
   */
  getAllTemplates(): GroupTemplateDto[] {
    try {
      this.logger.log(
        '[getAllTemplates] Starting, templates count:',
        Object.keys(MCP_GROUP_TEMPLATES).length,
      );
      const result = Object.values(MCP_GROUP_TEMPLATES).map((template) => {
        this.logger.log('[getAllTemplates] Converting template:', template.slug);
        return this.templateToDto(template);
      });
      this.logger.log('[getAllTemplates] Successfully converted', result.length, 'templates');
      return result;
    } catch (e) {
      this.logger.error('[getAllTemplates] ERROR:', e);
      throw e;
    }
  }

  /**
   * Get a specific template by slug as DTO
   */
  getTemplateBySlug(slug: string): GroupTemplateDto | null {
    const template = MCP_GROUP_TEMPLATES[slug];
    if (!template) {
      return null;
    }
    return this.templateToDto(template);
  }

  /**
   * Sync all templates to the database
   *
   * @param force - Force update even if template hash matches
   * @returns Summary of sync operation
   */
  async syncAllTemplates(force = false): Promise<SyncTemplatesResponse> {
    this.logger.log('Starting template sync...');
    const slugs = Object.keys(MCP_GROUP_TEMPLATES);
    const results: TemplateSyncResult[] = [];

    for (const slug of slugs) {
      const result = await this.syncTemplate(slug, force);
      results.push(result);
    }

    const createdCount = results.filter((r) => r.action === 'created').length;
    const updatedCount = results.filter((r) => r.action === 'updated').length;
    const skippedCount = results.filter((r) => r.action === 'skipped').length;

    this.logger.log(
      `Template sync complete: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped`,
    );

    return {
      syncedCount: createdCount + updatedCount,
      createdCount,
      updatedCount,
      templates: results.map((r) => r.slug),
    };
  }

  /**
   * Sync a single template to the database
   *
   * @param slug - Template slug to sync
   * @param force - Force update even if template hash matches
   * @returns Sync result for the template
   */
  async syncTemplate(slug: string, force = false): Promise<TemplateSyncResult> {
    const template = MCP_GROUP_TEMPLATES[slug];
    if (!template) {
      throw new Error(`Template '${slug}' not found`);
    }

    const templateHash = computeTemplateHash(template);
    const existingGroup = await this.groupsRepository.findBySlug(slug);

    if (!existingGroup) {
      // Create new group from template
      return this.createGroupFromTemplate(template, templateHash);
    }

    // Check if update is needed
    const needsUpdate = force || existingGroup.templateHash !== templateHash;

    if (!needsUpdate) {
      return {
        slug,
        action: 'skipped',
        groupId: existingGroup.id,
        serversSynced: 0,
        templateHash,
      };
    }

    // Update existing group
    return this.updateGroupFromTemplate(existingGroup.id, template, templateHash);
  }

  /**
   * Create a new group from a template
   */
  private async createGroupFromTemplate(
    template: McpGroupTemplate,
    templateHash: string,
  ): Promise<TemplateSyncResult> {
    this.logger.log(`Creating group '${template.slug}' from template...`);

    return this.db.transaction(async (tx) => {
      // Create the group
      const [group] = await tx
        .insert(mcpGroups)
        .values({
          slug: template.slug,
          name: template.name,
          description: template.description ?? null,
          credentialContractName: template.credentialContractName,
          credentialMapping: template.credentialMapping ?? null,
          defaultDockerImage: template.defaultDockerImage,
          enabled: true,
          templateHash,
        })
        .returning();

      // Create servers and relationships
      let serversSynced = 0;
      for (const serverTemplate of template.servers) {
        const server = await this.createServer(tx, group.id, serverTemplate);
        await this.createGroupServerRelation(tx, group.id, server.id, serverTemplate);
        serversSynced++;
      }

      this.logger.log(`Created group '${template.slug}' with ${serversSynced} servers`);

      return {
        slug: template.slug,
        action: 'created',
        groupId: group.id,
        serversSynced,
        templateHash,
      };
    });
  }

  /**
   * Update an existing group from a template
   */
  private async updateGroupFromTemplate(
    groupId: string,
    template: McpGroupTemplate,
    templateHash: string,
  ): Promise<TemplateSyncResult> {
    this.logger.log(`Updating group '${template.slug}' from template...`);

    return this.db.transaction(async (tx) => {
      // Update the group
      await tx
        .update(mcpGroups)
        .set({
          name: template.name,
          description: template.description ?? null,
          credentialContractName: template.credentialContractName,
          credentialMapping: template.credentialMapping ?? null,
          defaultDockerImage: template.defaultDockerImage,
          templateHash,
        })
        .where(eq(mcpGroups.id, groupId));

      // Get existing server relationships
      const existingRelations = await tx
        .select()
        .from(mcpGroupServers)
        .where(eq(mcpGroupServers.groupId, groupId));

      const existingServerMap = new Map(existingRelations.map((r) => [r.serverId, r]));

      // Track servers that should exist
      const targetServerNames = new Set(template.servers.map((s) => s.name));

      // Remove servers that are no longer in the template
      for (const [serverId] of existingServerMap) {
        const server = await tx
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.id, serverId))
          .limit(1);

        if (server.length > 0 && !targetServerNames.has(server[0].name)) {
          await tx.delete(mcpGroupServers).where(eq(mcpGroupServers.serverId, serverId));
          // Note: We don't delete the server itself as it might be used elsewhere
        }
      }

      // Create or update servers
      let serversSynced = 0;
      for (const serverTemplate of template.servers) {
        // Try to find existing server by name
        const existingServer = await tx
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.name, serverTemplate.name))
          .limit(1);

        let serverId: string;

        if (existingServer.length > 0) {
          // Update existing server
          serverId = existingServer[0].id;
          await tx
            .update(mcpServers)
            .set({
              description: serverTemplate.description ?? null,
              transportType: serverTemplate.transportType,
              endpoint: serverTemplate.endpoint ?? null,
              command: serverTemplate.command ?? null,
              args: serverTemplate.args ?? null,
              groupId,
              enabled: true,
            })
            .where(eq(mcpServers.id, serverId));
        } else {
          // Create new server
          const [newServer] = await tx
            .insert(mcpServers)
            .values({
              name: serverTemplate.name,
              description: serverTemplate.description ?? null,
              transportType: serverTemplate.transportType,
              endpoint: serverTemplate.endpoint ?? null,
              command: serverTemplate.command ?? null,
              args: serverTemplate.args ?? null,
              groupId,
              enabled: true,
            })
            .returning();
          serverId = newServer.id;
        }

        // Update or create relationship
        const existingRelation = existingServerMap.get(serverId);
        if (existingRelation) {
          await tx
            .update(mcpGroupServers)
            .set({
              recommended: serverTemplate.recommended ?? false,
              defaultSelected: serverTemplate.defaultSelected ?? true,
            })
            .where(eq(mcpGroupServers.serverId, serverId));
        } else {
          await tx.insert(mcpGroupServers).values({
            groupId,
            serverId,
            recommended: serverTemplate.recommended ?? false,
            defaultSelected: serverTemplate.defaultSelected ?? true,
          });
        }

        serversSynced++;
      }

      this.logger.log(`Updated group '${template.slug}' with ${serversSynced} servers`);

      return {
        slug: template.slug,
        action: 'updated',
        groupId,
        serversSynced,
        templateHash,
      };
    });
  }

  /**
   * Create a server from a template
   */
  private async createServer(
    tx: NodePgDatabase,
    groupId: string,
    serverTemplate: any,
  ): Promise<{ id: string }> {
    const [server] = await tx
      .insert(mcpServers)
      .values({
        name: serverTemplate.name,
        description: serverTemplate.description ?? null,
        transportType: serverTemplate.transportType,
        endpoint: serverTemplate.endpoint ?? null,
        command: serverTemplate.command ?? null,
        args: serverTemplate.args ?? null,
        groupId,
        enabled: true,
      })
      .returning();

    return server;
  }

  /**
   * Create a group-server relationship
   */
  private async createGroupServerRelation(
    tx: NodePgDatabase,
    groupId: string,
    serverId: string,
    serverTemplate: any,
  ): Promise<void> {
    await tx.insert(mcpGroupServers).values({
      groupId,
      serverId,
      recommended: serverTemplate.recommended ?? false,
      defaultSelected: serverTemplate.defaultSelected ?? true,
    });
  }

  /**
   * Convert a template to a DTO
   */
  private templateToDto(template: McpGroupTemplate): GroupTemplateDto {
    const dto = new GroupTemplateDto();
    dto.slug = template.slug;
    dto.name = template.name;
    dto.description = template.description;
    dto.credentialContractName = template.credentialContractName;
    dto.credentialMapping = template.credentialMapping;
    dto.defaultDockerImage = template.defaultDockerImage;
    dto.version = template.version;
    dto.templateHash = computeTemplateHash(template);
    dto.servers = template.servers.map((server) => {
      return {
        id: server.id,
        name: server.name,
        description: server.description,
        transportType: server.transportType,
        endpoint: server.endpoint,
        command: server.command,
        args: server.args,
        recommended: server.recommended ?? false,
        defaultSelected: server.defaultSelected ?? true,
      };
    });
    return dto;
  }
}
