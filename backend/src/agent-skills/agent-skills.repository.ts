import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL, or, isNull } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { agentSkills, type AgentSkillRecord, type NewAgentSkillRecord } from '../database/schema';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

export interface AgentSkillQueryOptions {
  organizationId?: string | null;
}

export interface AgentSkillUpdateData {
  name?: string;
  description?: string;
  content?: string;
  files?: { path: string; content: string; executable?: boolean }[];
  license?: string | null;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  allowedTools?: string | null;
  isEnabled?: boolean;
}

@Injectable()
export class AgentSkillsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async list(options: AgentSkillQueryOptions = {}): Promise<AgentSkillRecord[]> {
    const conditions: (SQL | undefined)[] = [];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(agentSkills.organizationId, options.organizationId),
          isNull(agentSkills.organizationId),
        ),
      );
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions.filter((c): c is SQL => c !== undefined));

    const rows = await (
      whereClause
        ? this.db.select().from(agentSkills).where(whereClause)
        : this.db.select().from(agentSkills)
    ).orderBy(agentSkills.name);

    return rows;
  }

  async listEnabled(options: AgentSkillQueryOptions = {}): Promise<AgentSkillRecord[]> {
    const conditions: (SQL | undefined)[] = [eq(agentSkills.isEnabled, true)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(agentSkills.organizationId, options.organizationId),
          isNull(agentSkills.organizationId),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(agentSkills)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .orderBy(agentSkills.name);

    return rows;
  }

  async findById(id: string, options: AgentSkillQueryOptions = {}): Promise<AgentSkillRecord> {
    const conditions: (SQL | undefined)[] = [eq(agentSkills.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(agentSkills.organizationId, options.organizationId),
          isNull(agentSkills.organizationId),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(agentSkills)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Agent skill ${id} not found`);
    }

    return row;
  }

  async create(
    data: Omit<NewAgentSkillRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AgentSkillRecord> {
    try {
      const [skill] = await this.db
        .insert(agentSkills)
        .values({
          ...data,
          organizationId: data.organizationId ?? DEFAULT_ORGANIZATION_ID,
        })
        .returning();

      return skill;
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`Agent skill name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: AgentSkillUpdateData,
    options: AgentSkillQueryOptions = {},
  ): Promise<AgentSkillRecord> {
    const conditions: (SQL | undefined)[] = [eq(agentSkills.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(agentSkills.organizationId, options.organizationId),
          isNull(agentSkills.organizationId),
        ),
      );
    }

    try {
      const [updated] = await this.db
        .update(agentSkills)
        .set({
          ...data,
          updatedAt: sql`now()`,
        })
        .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
        .returning();

      if (!updated) {
        throw new NotFoundException(`Agent skill ${id} not found`);
      }

      return updated;
    } catch (error: any) {
      if (error?.code === '23505' && data.name) {
        throw new ConflictException(`Agent skill name '${data.name}' already exists`);
      }
      throw error;
    }
  }

  async delete(id: string, options: AgentSkillQueryOptions = {}): Promise<void> {
    const conditions: (SQL | undefined)[] = [eq(agentSkills.id, id)];
    if (options.organizationId) {
      conditions.push(
        or(
          eq(agentSkills.organizationId, options.organizationId),
          isNull(agentSkills.organizationId),
        ),
      );
    }

    const deleted = await this.db
      .delete(agentSkills)
      .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
      .returning({ id: agentSkills.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Agent skill ${id} not found`);
    }
  }
}
