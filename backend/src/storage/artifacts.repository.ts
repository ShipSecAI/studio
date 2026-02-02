import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  artifactsTable,
  type ArtifactRecord,
  type NewArtifactRecord,
} from '../database/schema/artifacts.schema';

interface ArtifactQueryOptions {
  organizationId?: string | null;
  workflowId?: string;
  componentId?: string;
  destination?: 'run' | 'library';
  search?: string;
  limit?: number;
}

@Injectable()
export class ArtifactsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(record: NewArtifactRecord): Promise<ArtifactRecord> {
    const [artifact] = await this.db.insert(artifactsTable).values(record).returning();
    return artifact;
  }

  async listByRun(
    runId: string,
    options: { organizationId?: string | null } = {},
  ): Promise<ArtifactRecord[]> {
    return this.db
      .select()
      .from(artifactsTable)
      .where(this.buildRunFilter(runId, options.organizationId))
      .orderBy(desc(artifactsTable.createdAt));
  }

  async list(options: ArtifactQueryOptions = {}): Promise<ArtifactRecord[]> {
    const filters = this.buildFilters(options);

    const query = this.db.select().from(artifactsTable);
    const filtered =
      filters.length > 0 ? query.where(filters.length > 1 ? and(...filters) : filters[0]) : query;
    return filtered.orderBy(desc(artifactsTable.createdAt)).limit(options.limit ?? 50);
  }

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<ArtifactRecord | null> {
    const filters = [eq(artifactsTable.id, id)];
    if (options.organizationId) {
      filters.push(eq(artifactsTable.organizationId, options.organizationId));
    }
    const where = filters.length > 1 ? and(...filters) : filters[0];
    const [artifact] = await this.db.select().from(artifactsTable).where(where);
    return artifact ?? null;
  }

  async findByIdForRun(
    id: string,
    runId: string,
    options: { organizationId?: string | null } = {},
  ): Promise<ArtifactRecord | null> {
    const filters = [eq(artifactsTable.id, id), eq(artifactsTable.runId, runId)];
    if (options.organizationId) {
      filters.push(eq(artifactsTable.organizationId, options.organizationId));
    }
    const [artifact] = await this.db
      .select()
      .from(artifactsTable)
      .where(and(...filters))
      .limit(1);
    return artifact ?? null;
  }

  private buildRunFilter(runId: string, organizationId?: string | null) {
    const base = eq(artifactsTable.runId, runId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(artifactsTable.organizationId, organizationId));
  }

  async delete(id: string, options: { organizationId?: string | null } = {}): Promise<boolean> {
    const filters = [eq(artifactsTable.id, id)];
    if (options.organizationId) {
      filters.push(eq(artifactsTable.organizationId, options.organizationId));
    }
    const where = filters.length > 1 ? and(...filters) : filters[0];
    const result = await this.db.delete(artifactsTable).where(where).returning();
    return result.length > 0;
  }

  private buildFilters(options: ArtifactQueryOptions) {
    const filters = [];

    if (options.organizationId) {
      filters.push(eq(artifactsTable.organizationId, options.organizationId));
    }
    if (options.workflowId) {
      filters.push(eq(artifactsTable.workflowId, options.workflowId));
    }
    if (options.componentId) {
      filters.push(eq(artifactsTable.componentId, options.componentId));
    }
    if (options.destination) {
      filters.push(
        sql`${artifactsTable.destinations} @> ${JSON.stringify([options.destination])}::jsonb`,
      );
    }
    if (options.search) {
      const term = `%${options.search.trim().toLowerCase()}%`;
      filters.push(ilike(artifactsTable.name, term));
    }

    return filters;
  }
}
