import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  mcpServers,
  mcpServerTools,
  type McpServerRecord,
  type NewMcpServerRecord,
  type McpServerToolRecord,
  type NewMcpServerToolRecord,
} from '../database/schema';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

export interface McpServerQueryOptions {
  organizationId?: string | null;
}

export interface McpServerUpdateData {
  name?: string;
  description?: string | null;
  transportType?: string;
  endpoint?: string | null;
  command?: string | null;
  args?: string[] | null;
  headers?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyId: string;
  } | null;
  enabled?: boolean;
  healthCheckUrl?: string | null;
  lastHealthCheck?: Date;
  lastHealthStatus?: string;
}

@Injectable()
export class McpServersRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async list(options: McpServerQueryOptions = {}): Promise<McpServerRecord[]> {
    const conditions: SQL[] = [];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

    const rows = await (whereClause
      ? this.db.select().from(mcpServers).where(whereClause)
      : this.db.select().from(mcpServers)
    ).orderBy(mcpServers.name);

    return rows;
  }

  async listEnabled(options: McpServerQueryOptions = {}): Promise<McpServerRecord[]> {
    const conditions: SQL[] = [eq(mcpServers.enabled, true)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions))
      .orderBy(mcpServers.name);

    return rows;
  }

  async findById(id: string, options: McpServerQueryOptions = {}): Promise<McpServerRecord> {
    const conditions: SQL[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }

    return row;
  }

  async findByName(name: string, options: McpServerQueryOptions = {}): Promise<McpServerRecord | null> {
    const conditions: SQL[] = [eq(mcpServers.name, name)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ?? null;
  }

  async create(
    data: Omit<NewMcpServerRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<McpServerRecord> {
    try {
      const [server] = await this.db
        .insert(mcpServers)
        .values({
          ...data,
          organizationId: data.organizationId ?? DEFAULT_ORGANIZATION_ID,
        })
        .returning();

      return server;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`MCP server name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: McpServerUpdateData,
    options: McpServerQueryOptions = {},
  ): Promise<McpServerRecord> {
    const conditions: SQL[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    try {
      const [updated] = await this.db
        .update(mcpServers)
        .set({
          ...data,
          updatedAt: sql`now()`,
        })
        .where(and(...conditions))
        .returning();

      if (!updated) {
        throw new NotFoundException(`MCP server ${id} not found`);
      }

      return updated;
    } catch (error: any) {
      if (error?.code === '23505' && data.name) {
        throw new ConflictException(`MCP server name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async updateHealthStatus(
    id: string,
    status: 'healthy' | 'unhealthy' | 'unknown',
    options: McpServerQueryOptions = {},
  ): Promise<void> {
    const conditions: SQL[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    await this.db
      .update(mcpServers)
      .set({
        lastHealthCheck: sql`now()`,
        lastHealthStatus: status,
        updatedAt: sql`now()`,
      })
      .where(and(...conditions));
  }

  async delete(id: string, options: McpServerQueryOptions = {}): Promise<void> {
    const conditions: SQL[] = [eq(mcpServers.id, id)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const deleted = await this.db
      .delete(mcpServers)
      .where(and(...conditions))
      .returning({ id: mcpServers.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }
  }

  // Tool management methods

  async listTools(serverId: string): Promise<McpServerToolRecord[]> {
    return this.db
      .select()
      .from(mcpServerTools)
      .where(eq(mcpServerTools.serverId, serverId))
      .orderBy(mcpServerTools.toolName);
  }

  async listAllToolsForOrganization(
    options: McpServerQueryOptions = {},
  ): Promise<Array<McpServerToolRecord & { serverName: string }>> {
    const conditions: SQL[] = [eq(mcpServers.enabled, true)];
    if (options.organizationId) {
      conditions.push(eq(mcpServers.organizationId, options.organizationId));
    }

    const rows = await this.db
      .select({
        id: mcpServerTools.id,
        serverId: mcpServerTools.serverId,
        toolName: mcpServerTools.toolName,
        description: mcpServerTools.description,
        inputSchema: mcpServerTools.inputSchema,
        enabled: mcpServerTools.enabled,
        discoveredAt: mcpServerTools.discoveredAt,
        serverName: mcpServers.name,
      })
      .from(mcpServerTools)
      .innerJoin(mcpServers, eq(mcpServerTools.serverId, mcpServers.id))
      .where(and(...conditions))
      .orderBy(mcpServers.name, mcpServerTools.toolName);

    return rows;
  }

  async toggleToolEnabled(toolId: string): Promise<McpServerToolRecord> {
    // First get current state
    const [current] = await this.db
      .select()
      .from(mcpServerTools)
      .where(eq(mcpServerTools.id, toolId))
      .limit(1);

    if (!current) {
      throw new NotFoundException(`Tool ${toolId} not found`);
    }

    // Toggle the enabled state
    const [updated] = await this.db
      .update(mcpServerTools)
      .set({ enabled: !current.enabled })
      .where(eq(mcpServerTools.id, toolId))
      .returning();

    return updated;
  }

  async upsertTools(
    serverId: string,
    tools: Array<Omit<NewMcpServerToolRecord, 'id' | 'serverId' | 'discoveredAt' | 'enabled'>>,
  ): Promise<McpServerToolRecord[]> {
    if (tools.length === 0) {
      // Clear existing tools if none discovered
      await this.db.delete(mcpServerTools).where(eq(mcpServerTools.serverId, serverId));
      return [];
    }

    // Use a transaction to upsert tools while preserving enabled state
    return this.db.transaction(async (tx) => {
      // Get existing tools to preserve enabled state
      const existingTools = await tx
        .select()
        .from(mcpServerTools)
        .where(eq(mcpServerTools.serverId, serverId));

      const existingToolMap = new Map(existingTools.map((t) => [t.toolName, t]));
      const discoveredToolNames = new Set(tools.map((t) => t.toolName));

      // Delete tools that no longer exist
      const toolsToDelete = existingTools.filter((t) => !discoveredToolNames.has(t.toolName));
      if (toolsToDelete.length > 0) {
        await tx
          .delete(mcpServerTools)
          .where(
            and(
              eq(mcpServerTools.serverId, serverId),
              sql`${mcpServerTools.toolName} IN (${sql.join(toolsToDelete.map((t) => sql`${t.toolName}`), sql`, `)})`
            )
          );
      }

      // Upsert each tool
      const results: McpServerToolRecord[] = [];
      for (const tool of tools) {
        const existing = existingToolMap.get(tool.toolName);
        if (existing) {
          // Update existing tool (preserve enabled state)
          const [updated] = await tx
            .update(mcpServerTools)
            .set({
              description: tool.description,
              inputSchema: tool.inputSchema,
              discoveredAt: sql`now()`,
            })
            .where(eq(mcpServerTools.id, existing.id))
            .returning();
          results.push(updated);
        } else {
          // Insert new tool (default enabled=true)
          const [inserted] = await tx
            .insert(mcpServerTools)
            .values({
              ...tool,
              serverId,
              enabled: true,
            })
            .returning();
          results.push(inserted);
        }
      }

      return results;
    });
  }

  async clearTools(serverId: string): Promise<void> {
    await this.db.delete(mcpServerTools).where(eq(mcpServerTools.serverId, serverId));
  }
}
