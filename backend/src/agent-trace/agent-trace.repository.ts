import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, asc, eq, gt } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { agentTraceEventsTable, type AgentTraceEventRecord } from '../database/schema';

export interface AgentTraceEventInput {
  agentRunId: string;
  workflowRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
}

@Injectable()
export class AgentTraceRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async append(event: AgentTraceEventInput): Promise<void> {
    await this.db.insert(agentTraceEventsTable).values({
      agentRunId: event.agentRunId,
      workflowRunId: event.workflowRunId,
      nodeRef: event.nodeRef,
      sequence: event.sequence,
      timestamp: new Date(event.timestamp),
      partType: typeof event.part?.type === 'string' ? String(event.part.type) : 'data',
      payload: event.part,
    });
  }

  async list(agentRunId: string): Promise<AgentTraceEventRecord[]> {
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(eq(agentTraceEventsTable.agentRunId, agentRunId))
      .orderBy(asc(agentTraceEventsTable.sequence));
  }

  async listAfter(agentRunId: string, sequence: number): Promise<AgentTraceEventRecord[]> {
    return this.db
      .select()
      .from(agentTraceEventsTable)
      .where(
        and(
          eq(agentTraceEventsTable.agentRunId, agentRunId),
          gt(agentTraceEventsTable.sequence, sequence),
        ),
      )
      .orderBy(asc(agentTraceEventsTable.sequence));
  }

  async getRunMetadata(agentRunId: string): Promise<{ workflowRunId: string; nodeRef: string } | null> {
    const rows = await this.db
      .select({
        workflowRunId: agentTraceEventsTable.workflowRunId,
        nodeRef: agentTraceEventsTable.nodeRef,
      })
      .from(agentTraceEventsTable)
      .where(eq(agentTraceEventsTable.agentRunId, agentRunId))
      .orderBy(asc(agentTraceEventsTable.sequence))
      .limit(1);

    if (!rows.length) {
      return null;
    }

    return rows[0];
  }
}
