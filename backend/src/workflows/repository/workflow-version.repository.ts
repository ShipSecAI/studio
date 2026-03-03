import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, and, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  workflowVersionsTable,
  type WorkflowVersionGraph,
  type WorkflowVersionRecord,
} from '../../database/schema';
import { WorkflowDefinition } from '../../dsl/types';

interface CreateWorkflowVersionInput {
  workflowId: string;
  graph: WorkflowVersionGraph;
  organizationId?: string | null;
}

interface FindByWorkflowVersionInput {
  workflowId: string;
  version: number;
  organizationId?: string | null;
}

@Injectable()
export class WorkflowVersionRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(input: CreateWorkflowVersionInput): Promise<WorkflowVersionRecord> {
    const latest = await this.findLatestByWorkflowId(input.workflowId, {
      organizationId: input.organizationId ?? null,
    });
    const nextVersion = latest ? latest.version + 1 : 1;

    const [record] = await this.db
      .insert(workflowVersionsTable)
      .values({
        workflowId: input.workflowId,
        version: nextVersion,
        graph: input.graph,
        organizationId: input.organizationId ?? null,
      })
      .returning();

    return record;
  }

  async findLatestByWorkflowId(
    workflowId: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowVersionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowVersionsTable)
      .where(this.buildWorkflowFilter(workflowId, options.organizationId))
      .orderBy(desc(workflowVersionsTable.version))
      .limit(1);

    return record;
  }

  async findById(
    id: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowVersionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowVersionsTable)
      .where(this.buildIdFilter(id, options.organizationId))
      .limit(1);

    return record;
  }

  async findByWorkflowAndVersion(
    input: FindByWorkflowVersionInput,
  ): Promise<WorkflowVersionRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowVersionsTable)
      .where(
        and(
          this.buildWorkflowFilter(input.workflowId, input.organizationId),
          eq(workflowVersionsTable.version, input.version),
        ),
      )
      .limit(1);

    return record;
  }

  async setCompiledDefinition(
    id: string,
    definition: WorkflowDefinition,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowVersionRecord | undefined> {
    const [record] = await this.db
      .update(workflowVersionsTable)
      .set({
        compiledDefinition: definition,
      })
      .where(this.buildIdFilter(id, options.organizationId))
      .returning();

    return record;
  }

  /**
   * Batch: fetch specific versions by ID in a single query.
   */
  async findByIds(
    ids: string[],
    options: { organizationId?: string | null } = {},
  ): Promise<Map<string, WorkflowVersionRecord>> {
    if (ids.length === 0) return new Map();

    const unique = [...new Set(ids)];
    const conditions = [inArray(workflowVersionsTable.id, unique)];
    if (options.organizationId) {
      conditions.push(eq(workflowVersionsTable.organizationId, options.organizationId));
    }

    const records = await this.db
      .select()
      .from(workflowVersionsTable)
      .where(and(...conditions));

    return new Map(records.map((r) => [r.id, r]));
  }

  /**
   * Batch: fetch the latest version for each workflow ID in a single query.
   * Uses a window function to pick the max version per workflow.
   */
  async findLatestByWorkflowIds(
    workflowIds: string[],
    options: { organizationId?: string | null } = {},
  ): Promise<Map<string, WorkflowVersionRecord>> {
    if (workflowIds.length === 0) return new Map();

    const unique = [...new Set(workflowIds)];
    const conditions = [inArray(workflowVersionsTable.workflowId, unique)];
    if (options.organizationId) {
      conditions.push(eq(workflowVersionsTable.organizationId, options.organizationId));
    }

    // Use DISTINCT ON to get the latest version per workflow
    // Alias snake_case columns to camelCase so the result matches WorkflowVersionRecord
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ON (workflow_id)
        id,
        workflow_id AS "workflowId",
        version,
        graph,
        compiled_definition AS "compiledDefinition",
        organization_id AS "organizationId",
        created_at AS "createdAt"
      FROM workflow_versions
      WHERE workflow_id = ANY(${unique})
        ${options.organizationId ? sql`AND organization_id = ${options.organizationId}` : sql``}
      ORDER BY workflow_id, version DESC
    `);

    const result = new Map<string, WorkflowVersionRecord>();
    for (const row of rows.rows as WorkflowVersionRecord[]) {
      result.set(row.workflowId, row);
    }
    return result;
  }

  private buildWorkflowFilter(workflowId: string, organizationId?: string | null) {
    const base = eq(workflowVersionsTable.workflowId, workflowId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowVersionsTable.organizationId, organizationId));
  }

  private buildIdFilter(id: string, organizationId?: string | null) {
    const base = eq(workflowVersionsTable.id, id);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowVersionsTable.organizationId, organizationId));
  }
}
