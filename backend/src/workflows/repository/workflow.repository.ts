import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { workflowsTable } from '../../database/schema/workflows';
import { DRIZZLE_TOKEN } from '../../database/database.module';

export type WorkflowRecord = typeof workflowsTable.$inferSelect;

export interface WorkflowSummaryRecord {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  lastRun: Date | null;
  runCount: number;
  nodeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface WorkflowRepositoryOptions {
  organizationId?: string | null;
}

@Injectable()
export class WorkflowRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(
    input: WorkflowGraph,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .insert(workflowsTable)
      .values({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
        organizationId: options.organizationId ?? null,
      })
      .returning();

    return record;
  }

  async update(
    id: string,
    input: WorkflowGraph,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async updateMetadata(
    id: string,
    metadata: { name: string; description?: string | null },
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        name: metadata.name,
        description: metadata.description ?? null,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async saveCompiledDefinition(
    id: string,
    definition: WorkflowDefinition,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        compiledDefinition: definition,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  async findById(
    id: string,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowsTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);
    return record;
  }

  async delete(id: string, options: WorkflowRepositoryOptions = {}): Promise<void> {
    await this.db.delete(workflowsTable).where(this.buildIdFilter(id, options.organizationId));
  }

  async list(options: WorkflowRepositoryOptions = {}): Promise<WorkflowRecord[]> {
    if (options.organizationId) {
      return this.db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.organizationId, options.organizationId));
    }
    return this.db.select().from(workflowsTable);
  }

  async listSummary(options: WorkflowRepositoryOptions = {}): Promise<WorkflowSummaryRecord[]> {
    const columns = {
      id: workflowsTable.id,
      name: workflowsTable.name,
      description: workflowsTable.description,
      organizationId: workflowsTable.organizationId,
      lastRun: workflowsTable.lastRun,
      runCount: workflowsTable.runCount,
      nodeCount: sql<number>`coalesce(jsonb_array_length(${workflowsTable.graph}->'nodes'), 0)`.as(
        'node_count',
      ),
      createdAt: workflowsTable.createdAt,
      updatedAt: workflowsTable.updatedAt,
    };

    if (options.organizationId) {
      return this.db
        .select(columns)
        .from(workflowsTable)
        .where(eq(workflowsTable.organizationId, options.organizationId));
    }
    return this.db.select(columns).from(workflowsTable);
  }

  async incrementRunCount(
    id: string,
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .update(workflowsTable)
      .set({
        lastRun: new Date(),
        runCount: sql`${workflowsTable.runCount} + 1`,
        updatedAt: new Date(),
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    if (!record) {
      throw new Error(`Workflow ${id} not found`);
    }

    return record;
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const idFilter = eq(workflowsTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(workflowsTable.organizationId, organizationId));
  }
}
