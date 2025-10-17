import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  workflowLogStreamsTable,
  type WorkflowLogStreamRecord,
} from '../database/schema';
import { DRIZZLE_TOKEN } from '../database/database.module';

@Injectable()
export class LogStreamRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async listByRunId(
    runId: string,
    nodeRef?: string,
    stream?: 'stdout' | 'stderr' | 'console',
  ): Promise<WorkflowLogStreamRecord[]> {
    const conditions: Array<ReturnType<typeof eq>> = [
      eq(workflowLogStreamsTable.runId, runId),
    ];

    if (nodeRef) {
      conditions.push(eq(workflowLogStreamsTable.nodeRef, nodeRef));
    }

    if (stream) {
      conditions.push(eq(workflowLogStreamsTable.stream, stream));
    }

    const whereClause =
      conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.db
      .select()
      .from(workflowLogStreamsTable)
      .where(whereClause)
      .orderBy(workflowLogStreamsTable.firstTimestamp);
  }
}
