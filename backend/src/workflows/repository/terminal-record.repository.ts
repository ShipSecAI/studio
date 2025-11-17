import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../../database/database.module';
import {
  workflowTerminalRecordsTable,
  type WorkflowTerminalRecord,
  type WorkflowTerminalRecordInsert,
} from '../../database/schema';

@Injectable()
export class TerminalRecordRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async create(input: WorkflowTerminalRecordInsert): Promise<WorkflowTerminalRecord> {
    const [record] = await this.db
      .insert(workflowTerminalRecordsTable)
      .values({ ...input, createdAt: input.createdAt ?? new Date() })
      .returning();
    return record;
  }

  async listByRun(runId: string, organizationId?: string | null): Promise<WorkflowTerminalRecord[]> {
    return this.db
      .select()
      .from(workflowTerminalRecordsTable)
      .where(this.buildRunFilter(runId, organizationId))
      .orderBy(desc(workflowTerminalRecordsTable.createdAt));
  }

  async findById(id: number, options: { runId: string; organizationId?: string | null }) {
    const [record] = await this.db
      .select()
      .from(workflowTerminalRecordsTable)
      .where(
        and(
          eq(workflowTerminalRecordsTable.id, id),
          this.buildRunFilter(options.runId, options.organizationId),
        ),
      )
      .limit(1);
    return record;
  }

  private buildRunFilter(runId: string, organizationId?: string | null) {
    const base = eq(workflowTerminalRecordsTable.runId, runId);
    if (!organizationId) {
      return base;
    }
    return and(base, eq(workflowTerminalRecordsTable.organizationId, organizationId));
  }
}
