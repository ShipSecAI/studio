import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatTurnsTable, type ChatTurn, type NewChatTurn } from '../database/schema';

const TERMINAL_STATUSES = ['completed', 'interrupted', 'failed', 'cancelled'] as const;
export type ChatTurnStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'cancelled';

@Injectable()
export class ChatTurnRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async enqueueTurnWithUserMessage(input: {
    sessionId: string;
    message: string;
    clientMessageId?: string;
  }): Promise<{ turn: ChatTurn; position: number; created: boolean }> {
    const existing =
      input.clientMessageId == null
        ? null
        : await this.getByClientMessageId(input.sessionId, input.clientMessageId);
    if (existing) {
      return {
        turn: existing,
        position: await this.getQueuePosition(input.sessionId, existing.id),
        created: false,
      };
    }

    return this.db.transaction(async (tx) => {
      const values: NewChatTurn = {
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId ?? null,
        userMessage: input.message,
        status: 'queued',
      };

      const [turn] = await tx.insert(chatTurnsTable).values(values).returning();

      const [countRow] = await tx
        .select({ value: count() })
        .from(chatTurnsTable)
        .where(
          and(eq(chatTurnsTable.sessionId, input.sessionId), eq(chatTurnsTable.status, 'queued')),
        );

      return {
        turn,
        position: Number(countRow?.value ?? 0),
        created: true,
      };
    });
  }

  async getByClientMessageId(sessionId: string, clientMessageId: string): Promise<ChatTurn | null> {
    const [turn] = await this.db
      .select()
      .from(chatTurnsTable)
      .where(
        and(
          eq(chatTurnsTable.sessionId, sessionId),
          eq(chatTurnsTable.clientMessageId, clientMessageId),
        ),
      )
      .limit(1);

    return turn ?? null;
  }

  async getTurn(sessionId: string, turnId: string): Promise<ChatTurn> {
    const [turn] = await this.db
      .select()
      .from(chatTurnsTable)
      .where(and(eq(chatTurnsTable.id, turnId), eq(chatTurnsTable.sessionId, sessionId)))
      .limit(1);

    if (!turn) {
      throw new NotFoundException(`Turn ${turnId} not found in session ${sessionId}`);
    }

    return turn;
  }

  async getRunningTurn(sessionId: string): Promise<ChatTurn | null> {
    const [turn] = await this.db
      .select()
      .from(chatTurnsTable)
      .where(and(eq(chatTurnsTable.sessionId, sessionId), eq(chatTurnsTable.status, 'running')))
      .limit(1);

    return turn ?? null;
  }

  async getLatestTurn(sessionId: string): Promise<ChatTurn | null> {
    const [turn] = await this.db
      .select()
      .from(chatTurnsTable)
      .where(eq(chatTurnsTable.sessionId, sessionId))
      .orderBy(sql`${chatTurnsTable.queuedAt} desc`, sql`${chatTurnsTable.createdAt} desc`)
      .limit(1);

    return turn ?? null;
  }

  async listQueuedTurns(sessionId: string, limit = 50): Promise<ChatTurn[]> {
    return this.db
      .select()
      .from(chatTurnsTable)
      .where(and(eq(chatTurnsTable.sessionId, sessionId), eq(chatTurnsTable.status, 'queued')))
      .orderBy(asc(chatTurnsTable.queuedAt), asc(chatTurnsTable.createdAt))
      .limit(limit);
  }

  async listInterruptedTurns(sessionId: string): Promise<ChatTurn[]> {
    return this.db
      .select()
      .from(chatTurnsTable)
      .where(and(eq(chatTurnsTable.sessionId, sessionId), eq(chatTurnsTable.status, 'interrupted')))
      .orderBy(asc(chatTurnsTable.queuedAt), asc(chatTurnsTable.createdAt));
  }

  async getQueuePosition(sessionId: string, turnId: string): Promise<number> {
    const turn = await this.getTurn(sessionId, turnId);
    if (turn.status !== 'queued') {
      return 0;
    }

    const [row] = await this.db
      .select({ value: count() })
      .from(chatTurnsTable)
      .where(
        and(
          eq(chatTurnsTable.sessionId, sessionId),
          eq(chatTurnsTable.status, 'queued'),
          sql`${chatTurnsTable.queuedAt} <= ${turn.queuedAt}`,
        ),
      );

    return Number(row?.value ?? 0);
  }

  async setTurnRunning(
    sessionId: string,
    turnId: string,
    runId?: string,
    generationId?: string,
  ): Promise<{ promoted: boolean; userMessage?: string }> {
    return this.db.transaction(async (tx) => {
      const [promotedTurn] = await tx
        .update(chatTurnsTable)
        .set({
          status: 'running',
          runId: runId ?? null,
          generationId: generationId ?? null,
          startedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(chatTurnsTable.id, turnId),
            eq(chatTurnsTable.sessionId, sessionId),
            eq(chatTurnsTable.status, 'queued'),
          ),
        )
        .returning({
          sessionId: chatTurnsTable.sessionId,
          userMessage: chatTurnsTable.userMessage,
        });

      if (promotedTurn) {
        return {
          promoted: true,
          userMessage: promotedTurn.userMessage,
        };
      }

      await tx
        .update(chatTurnsTable)
        .set({
          runId: runId ?? null,
          generationId: generationId ?? null,
          startedAt: sql`coalesce(${chatTurnsTable.startedAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(chatTurnsTable.id, turnId),
            eq(chatTurnsTable.sessionId, sessionId),
            eq(chatTurnsTable.status, 'running'),
          ),
        );

      return { promoted: false };
    });
  }

  async setTurnStatus(sessionId: string, turnId: string, status: ChatTurnStatus) {
    await this.db
      .update(chatTurnsTable)
      .set({
        status,
        endedAt: TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number])
          ? sql`now()`
          : null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(chatTurnsTable.id, turnId), eq(chatTurnsTable.sessionId, sessionId)));
  }
}
