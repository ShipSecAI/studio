import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatSessionsTable, chatStreamEventsTable } from '../database/schema';

@Injectable()
export class ChatStreamEventRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async append(sessionId: string, runId: string, event: Record<string, unknown>): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [updatedSession] = await tx
        .update(chatSessionsTable)
        .set({
          nextEventSeq: sql`${chatSessionsTable.nextEventSeq} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(chatSessionsTable.id, sessionId), eq(chatSessionsTable.activeRunId, runId)))
        .returning({ nextEventSeq: chatSessionsTable.nextEventSeq });

      if (!updatedSession) {
        throw new Error(`Unable to append event: session ${sessionId} is not running ${runId}`);
      }

      const seq = updatedSession.nextEventSeq - 1;
      await tx.insert(chatStreamEventsTable).values({
        sessionId,
        runId,
        seq,
        event,
      });

      return seq;
    });
  }

  async listAfter(sessionId: string, runId: string, afterSeq: number, limit = 500) {
    return this.db
      .select({
        seq: chatStreamEventsTable.seq,
        event: chatStreamEventsTable.event,
      })
      .from(chatStreamEventsTable)
      .where(
        and(
          eq(chatStreamEventsTable.sessionId, sessionId),
          eq(chatStreamEventsTable.runId, runId),
          gt(chatStreamEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(chatStreamEventsTable.seq)
      .limit(limit);
  }
}
