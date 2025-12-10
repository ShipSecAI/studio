import { Injectable } from '@nestjs/common';

import { AgentTraceRepository } from './agent-trace.repository';

export type AgentTracePartEntry = {
  agentRunId: string;
  workflowRunId: string;
  nodeRef: string;
  sequence: number;
  timestamp: string;
  part: Record<string, unknown>;
};

@Injectable()
export class AgentTraceService {
  constructor(private readonly repository: AgentTraceRepository) {}

  async append(event: Parameters<AgentTraceRepository['append']>[0]): Promise<void> {
    await this.repository.append(event);
  }

  async getRunMetadata(agentRunId: string): Promise<{ workflowRunId: string; nodeRef: string } | null> {
    return this.repository.getRunMetadata(agentRunId);
  }

  async list(agentRunId: string, afterSequence?: number): Promise<AgentTracePartEntry[]> {
    const rows =
      afterSequence && afterSequence > 0
        ? await this.repository.listAfter(agentRunId, afterSequence)
        : await this.repository.list(agentRunId);

    return rows.map((row) => ({
      agentRunId: row.agentRunId,
      workflowRunId: row.workflowRunId,
      nodeRef: row.nodeRef,
      sequence: row.sequence,
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
      part: (row.payload ?? {}) as Record<string, unknown>,
    }));
  }
}
