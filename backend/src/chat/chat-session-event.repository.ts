import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatSessionEventsTable, chatSessionsTable } from '../database/schema';

@Injectable()
export class ChatSessionEventRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async append(input: {
    sessionId: string;
    turnId: string;
    runId?: string;
    generationId?: string;
    eventId: string;
    chunk: Record<string, unknown>;
  }): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [updatedSession] = await tx
        .update(chatSessionsTable)
        .set({
          nextEventSeq: sql`${chatSessionsTable.nextEventSeq} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(chatSessionsTable.id, input.sessionId))
        .returning({ nextEventSeq: chatSessionsTable.nextEventSeq });

      if (!updatedSession) {
        throw new Error(`Session ${input.sessionId} not found`);
      }

      const seq = updatedSession.nextEventSeq - 1;

      await tx
        .insert(chatSessionEventsTable)
        .values({
          sessionId: input.sessionId,
          turnId: input.turnId,
          runId: input.runId ?? null,
          generationId: input.generationId ?? null,
          eventId: input.eventId,
          seq,
          chunk: input.chunk,
        })
        .onConflictDoNothing({
          target: [chatSessionEventsTable.turnId, chatSessionEventsTable.eventId],
        });

      const [existing] = await tx
        .select({ seq: chatSessionEventsTable.seq })
        .from(chatSessionEventsTable)
        .where(
          and(
            eq(chatSessionEventsTable.turnId, input.turnId),
            eq(chatSessionEventsTable.eventId, input.eventId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error(`Failed to append event ${input.eventId} for turn ${input.turnId}`);
      }

      return existing.seq;
    });
  }

  async listAfter(sessionId: string, afterSeq: number, limit = 500) {
    return this.db
      .select({
        seq: chatSessionEventsTable.seq,
        turnId: chatSessionEventsTable.turnId,
        runId: chatSessionEventsTable.runId,
        generationId: chatSessionEventsTable.generationId,
        eventId: chatSessionEventsTable.eventId,
        chunk: chatSessionEventsTable.chunk,
      })
      .from(chatSessionEventsTable)
      .where(
        and(
          eq(chatSessionEventsTable.sessionId, sessionId),
          gt(chatSessionEventsTable.seq, afterSeq),
        ),
      )
      .orderBy(chatSessionEventsTable.seq)
      .limit(limit);
  }

  async getLastSeq(sessionId: string): Promise<number> {
    const [row] = await this.db
      .select({ seq: chatSessionEventsTable.seq })
      .from(chatSessionEventsTable)
      .where(eq(chatSessionEventsTable.sessionId, sessionId))
      .orderBy(desc(chatSessionEventsTable.seq))
      .limit(1);

    return row?.seq ?? 0;
  }
}
