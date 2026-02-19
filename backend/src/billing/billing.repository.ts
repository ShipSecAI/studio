import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_TOKEN } from '../database/database.module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import * as schema from '../database/schema';
import { workflowRunsTable } from '../database/schema/workflow-runs';
import { agentTraceEventsTable } from '../database/schema/agent-trace-events';

@Injectable()
export class BillingRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async countWorkflowRunsForPeriod(options: {
    organizationId: string;
    start: Date;
    end: Date;
  }): Promise<number> {
    const rows = await this.db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(workflowRunsTable)
      .where(
        and(
          eq(workflowRunsTable.organizationId, options.organizationId),
          gte(workflowRunsTable.createdAt, options.start),
          lt(workflowRunsTable.createdAt, options.end),
        ),
      );

    return rows[0]?.count ?? 0;
  }

  async sumAiTokensForPeriod(options: {
    organizationId: string;
    start: Date;
    end: Date;
  }): Promise<number> {
    // We store AI token usage as an agent trace event part with type="data-usage".
    // Link the trace event to an organization via workflow_runs.organization_id.
    const rows = await this.db
      .select({
        totalTokens: sql<number>`
          coalesce(
            sum(
              (${agentTraceEventsTable.payload} -> 'data' -> 'usage' ->> 'totalTokens')::int
            ),
            0
          )::int
        `,
      })
      .from(agentTraceEventsTable)
      .innerJoin(
        workflowRunsTable,
        eq(workflowRunsTable.runId, agentTraceEventsTable.workflowRunId),
      )
      .where(
        and(
          eq(workflowRunsTable.organizationId, options.organizationId),
          eq(agentTraceEventsTable.partType, 'data-usage'),
          gte(agentTraceEventsTable.timestamp, options.start),
          lt(agentTraceEventsTable.timestamp, options.end),
        ),
      );

    return rows[0]?.totalTokens ?? 0;
  }

  async findRunContextByRunId(runId: string): Promise<{
    workflowId: string;
    organizationId: string | null;
  } | null> {
    const rows = await this.db
      .select({
        workflowId: workflowRunsTable.workflowId,
        organizationId: workflowRunsTable.organizationId,
      })
      .from(workflowRunsTable)
      .where(eq(workflowRunsTable.runId, runId))
      .limit(1);

    return rows[0] ?? null;
  }
}
