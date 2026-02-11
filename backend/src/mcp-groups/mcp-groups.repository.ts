import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  mcpGroups,
  mcpGroupServers,
  type McpGroupRecord,
  type NewMcpGroupRecord,
  type McpGroupServerRecord,
  type McpServerRecord,
} from '../database/schema';

export interface McpGroupQueryOptions {
  enabled?: boolean;
}

export interface McpGroupUpdateData {
  name?: string;
  description?: string | null;
  credentialContractName?: string;
  credentialMapping?: Record<string, string> | null;
  defaultDockerImage?: string | null;
  enabled?: boolean;
}

@Injectable()
export class McpGroupsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async findAll(options: McpGroupQueryOptions = {}): Promise<McpGroupRecord[]> {
    const conditions: SQL[] = [];
    if (options.enabled !== undefined) {
      conditions.push(eq(mcpGroups.enabled, options.enabled));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const rows = await (
      whereClause
        ? this.db.select().from(mcpGroups).where(whereClause)
        : this.db.select().from(mcpGroups)
    ).orderBy(mcpGroups.name);

    return rows;
  }

  async findById(id: string): Promise<McpGroupRecord> {
    const rows = await this.db.select().from(mcpGroups).where(eq(mcpGroups.id, id)).limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`MCP group ${id} not found`);
    }

    return row;
  }

  async findBySlug(slug: string): Promise<McpGroupRecord | null> {
    const rows = await this.db.select().from(mcpGroups).where(eq(mcpGroups.slug, slug)).limit(1);

    return rows[0] ?? null;
  }

  async create(
    data: Omit<NewMcpGroupRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<McpGroupRecord> {
    try {
      const [group] = await this.db.insert(mcpGroups).values(data).returning();

      return group;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`MCP group slug '${data.slug}' already exists`);
      }
      throw error;
    }
  }

  async update(id: string, data: McpGroupUpdateData): Promise<McpGroupRecord> {
    try {
      const [updated] = await this.db
        .update(mcpGroups)
        .set({
          ...data,
          updatedAt: sql`now()`,
        })
        .where(eq(mcpGroups.id, id))
        .returning();

      if (!updated) {
        throw new NotFoundException(`MCP group ${id} not found`);
      }

      return updated;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`MCP group with this configuration already exists`);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.db
      .delete(mcpGroups)
      .where(eq(mcpGroups.id, id))
      .returning({ id: mcpGroups.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`MCP group ${id} not found`);
    }
  }

  // Group-Server relationship methods

  async findServersByGroup(
    groupId: string,
  ): Promise<
    (McpServerRecord & { recommended: boolean; defaultSelected: boolean; toolCount: number })[]
  > {
    // Use raw SQL for complex query with tool count
    const query = sql`
      SELECT
        s.id,
        s.name,
        s.description,
        s.transport_type,
        s.endpoint,
        s.command,
        s.args,
        s.headers,
        s.enabled,
        s.health_check_url,
        s.last_health_check,
        s.last_health_status,
        s.group_id,
        s.organization_id,
        s.created_by,
        s.created_at,
        s.updated_at,
        gs.recommended,
        gs.default_selected,
        COALESCE(tc.tool_count, 0) as tool_count
      FROM mcp_group_servers gs
      INNER JOIN mcp_servers s ON gs.server_id = s.id
      LEFT JOIN (
        SELECT server_id, COUNT(id) as tool_count
        FROM mcp_server_tools
        GROUP BY server_id
      ) tc ON tc.server_id = s.id
      WHERE gs.group_id = ${groupId}
      ORDER BY CASE WHEN gs.recommended THEN 0 ELSE 1 END ASC, s.name
    `;

    const result = await this.db.execute(query);
    return result.rows as (McpServerRecord & {
      recommended: boolean;
      defaultSelected: boolean;
      toolCount: number;
    })[];
  }

  async addServerToGroup(
    groupId: string,
    serverId: string,
    metadata?: {
      recommended?: boolean;
      defaultSelected?: boolean;
    },
  ): Promise<McpGroupServerRecord> {
    try {
      const [relation] = await this.db
        .insert(mcpGroupServers)
        .values({
          groupId,
          serverId,
          recommended: metadata?.recommended ?? false,
          defaultSelected: metadata?.defaultSelected ?? true,
        })
        .returning();

      return relation;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`Server ${serverId} is already in group ${groupId}`);
      }
      if (error?.code === '23503') {
        throw new NotFoundException(`Group ${groupId} or server ${serverId} not found`);
      }
      throw error;
    }
  }

  async removeServerFromGroup(groupId: string, serverId: string): Promise<void> {
    const deleted = await this.db
      .delete(mcpGroupServers)
      .where(and(eq(mcpGroupServers.groupId, groupId), eq(mcpGroupServers.serverId, serverId)))
      .returning({ groupId: mcpGroupServers.groupId, serverId: mcpGroupServers.serverId });

    if (deleted.length === 0) {
      throw new NotFoundException(`Server ${serverId} is not in group ${groupId}`);
    }
  }

  async updateServerMetadata(
    groupId: string,
    serverId: string,
    metadata: {
      recommended?: boolean;
      defaultSelected?: boolean;
    },
  ): Promise<McpGroupServerRecord> {
    const [updated] = await this.db
      .update(mcpGroupServers)
      .set(metadata)
      .where(and(eq(mcpGroupServers.groupId, groupId), eq(mcpGroupServers.serverId, serverId)))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Server ${serverId} is not in group ${groupId}`);
    }

    return updated;
  }
}
