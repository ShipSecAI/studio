import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  workflowRunsTable,
  type WorkflowRunInsert,
  type WorkflowRunRecord,
} from '../../database/schema';

interface CreateWorkflowRunInput {
  runId: string;
  workflowId: string;
  temporalRunId: string;
  totalActions: number;
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
      temporalRunId: input.temporalRunId,
      totalActions: input.totalActions,
      updatedAt: new Date(),
    };

    const [record] = await this.db
      .insert(workflowRunsTable)
      .values(values)
      .onConflictDoUpdate({
        target: workflowRunsTable.runId,
        set: {
          workflowId: input.workflowId,
          temporalRunId: input.temporalRunId,
          totalActions: input.totalActions,
          updatedAt: new Date(),
        },
      })
      .returning();

    return record;
  }

  async findByRunId(runId: string): Promise<WorkflowRunRecord | undefined> {
    const [record] = await this.db
      .select()
      .from(workflowRunsTable)
      .where(eq(workflowRunsTable.runId, runId))
      .limit(1);
    return record;
  }

  async list(options: {
    workflowId?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<WorkflowRunRecord[]> {
    const baseQuery = this.db.select().from(workflowRunsTable);
    const filteredQuery = options.workflowId
      ? baseQuery.where(eq(workflowRunsTable.workflowId, options.workflowId))
      : baseQuery;

    return await filteredQuery
      .orderBy(workflowRunsTable.createdAt)
      .limit(options.limit ?? 50);
  }
}
