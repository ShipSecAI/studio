import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import type { ExecutionStatus } from '@shipsec/shared';
import { WorkflowDefinition } from '../../dsl/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { workflowsTable } from '../../database/schema/workflows';
import { DRIZZLE_TOKEN } from '../../database/database.module';

export type WorkflowRecord = typeof workflowsTable.$inferSelect;

export interface WorkflowSummaryRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  iconColor: string | null;
  organizationId: string | null;
  isSystem: boolean;
  templateId: string | null;
  lastRun: Date | null;
  latestRunStatus: ExecutionStatus | null;
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

  async createSystemWorkflow(
    input: WorkflowGraph,
    options: { organizationId: string; templateId: string },
  ): Promise<WorkflowRecord> {
    const [record] = await this.db
      .insert(workflowsTable)
      .values({
        name: input.name,
        description: input.description ?? null,
        graph: input,
        compiledDefinition: null,
        organizationId: options.organizationId,
        isSystem: true,
        templateId: options.templateId,
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
    metadata: {
      name: string;
      description?: string | null;
      icon?: string | null;
      iconColor?: string | null;
    },
    options: WorkflowRepositoryOptions = {},
  ): Promise<WorkflowRecord> {
    const setValues: Record<string, any> = {
      name: metadata.name,
      description: metadata.description ?? null,
      updatedAt: new Date(),
    };
    if (metadata.icon !== undefined) setValues.icon = metadata.icon;
    if (metadata.iconColor !== undefined) setValues.iconColor = metadata.iconColor;

    const [record] = await this.db
      .update(workflowsTable)
      .set(setValues)
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
      icon: workflowsTable.icon,
      iconColor: workflowsTable.iconColor,
      organizationId: workflowsTable.organizationId,
      isSystem: workflowsTable.isSystem,
      templateId: workflowsTable.templateId,
      lastRun: workflowsTable.lastRun,
      latestRunStatus: sql<ExecutionStatus | null>`(
        SELECT wr.status FROM workflow_runs wr
        WHERE wr.workflow_id = ${workflowsTable.id}
        ORDER BY wr.created_at DESC
        LIMIT 1
      )`.as('latest_run_status'),
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

  /**
   * Batch: fetch multiple workflows by ID in a single query.
   */
  async findByIds(
    ids: string[],
    options: WorkflowRepositoryOptions = {},
  ): Promise<Map<string, WorkflowRecord>> {
    if (ids.length === 0) return new Map();

    const unique = [...new Set(ids)];
    const conditions = [inArray(workflowsTable.id, unique)];
    if (options.organizationId) {
      conditions.push(eq(workflowsTable.organizationId, options.organizationId));
    }

    const records = await this.db
      .select()
      .from(workflowsTable)
      .where(and(...conditions));

    return new Map(records.map((r) => [r.id, r]));
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const idFilter = eq(workflowsTable.id, id);
    if (!organizationId) {
      return idFilter;
    }
    return and(idFilter, eq(workflowsTable.organizationId, organizationId));
  }
}
