import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  workflowRunsTable,
  type WorkflowRunInsert,
  type WorkflowRunRecord,
} from '../../database/schema';
import type { ExecutionInputPreview, ExecutionTriggerType } from '@shipsec/shared';

interface CreateWorkflowRunInput {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  temporalRunId?: string | null;
  totalActions: number;
  inputs: Record<string, unknown>;
  organizationId?: string | null;
  triggerType: ExecutionTriggerType;
  triggerSource?: string | null;
  triggerLabel?: string | null;
  inputPreview?: ExecutionInputPreview;
}

@Injectable()
export class WorkflowRunRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsert(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord> {
    const values: WorkflowRunInsert = {
      runId: input.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      workflowVersion: input.workflowVersion,
      totalActions: input.totalActions,
      inputs: input.inputs ?? {},
      triggerType: input.triggerType,
      triggerSource: input.triggerSource ?? null,
      triggerLabel: input.triggerLabel ?? 'Manual run',
      inputPreview: input.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      updatedAt: new Date(),
      organizationId: input.organizationId ?? null,
    };

    if (input.temporalRunId !== undefined) {
      values.temporalRunId = input.temporalRunId;
    }

    const updateValues: Partial<WorkflowRunInsert> = {
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      workflowVersion: input.workflowVersion,
      totalActions: input.totalActions,
      inputs: input.inputs ?? {},
      triggerType: input.triggerType,
      triggerSource: input.triggerSource ?? null,
      triggerLabel: input.triggerLabel ?? 'Manual run',
      inputPreview: input.inputPreview ?? { runtimeInputs: {}, nodeOverrides: {} },
      updatedAt: new Date(),
      organizationId: input.organizationId ?? null,
    };

    if (input.temporalRunId !== undefined) {
      updateValues.temporalRunId = input.temporalRunId;
    }

    const [record] = await this.db
      .insert(workflowRunsTable)
      .values(values)
      .onConflictDoUpdate({
        target: workflowRunsTable.runId,
        set: updateValues,
      })
      .returning();

    return record;
  }

  async findByRunId(
    runId: string,
    options: { organizationId?: string | null } = {},
  ): Promise<WorkflowRunRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowRunsTable)
      .where(this.buildRunFilter(runId, options.organizationId))
      .limit(1);
    return record;
  }

  async list(options: {
    workflowId?: string;
    status?: string;
    limit?: number;
    organizationId?: string | null;
  } = {}): Promise<WorkflowRunRecord[]> {
    let condition: ReturnType<typeof eq> | undefined;

    if (options.workflowId) {
      condition = eq(workflowRunsTable.workflowId, options.workflowId);
    }

    if (options.organizationId) {
      const organizationCondition = eq(
        workflowRunsTable.organizationId,
        options.organizationId,
      );
      condition = condition ? and(condition, organizationCondition) : organizationCondition;
    }

    const baseQuery = this.db.select().from(workflowRunsTable);
    const filteredQuery = condition ? baseQuery.where(condition) : baseQuery;

    return await filteredQuery
      .orderBy(desc(workflowRunsTable.createdAt))
      .limit(options.limit ?? 50);
  }

  private buildRunFilter(runId: string, organizationId?: string | null) {
    const base = eq(workflowRunsTable.runId, runId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowRunsTable.organizationId, organizationId));
  }
}
