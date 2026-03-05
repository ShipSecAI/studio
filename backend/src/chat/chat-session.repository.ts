import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatSessionsTable, type ChatSession } from '../database/schema';

export interface ChatSessionQueryOptions {
  userId: string;
  organizationId?: string | null;
}

@Injectable()
export class ChatSessionRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async createSession(
    userId: string,
    organizationId?: string | null,
    title?: string,
  ): Promise<ChatSession> {
    const [session] = await this.db
      .insert(chatSessionsTable)
      .values({
        userId,
        organizationId: organizationId ?? null,
        title: title ?? 'New Conversation',
      })
      .returning();
    return session;
  }

  async listSessions(options: ChatSessionQueryOptions): Promise<ChatSession[]> {
    const conditions: SQL[] = [
      eq(chatSessionsTable.userId, options.userId),
      eq(chatSessionsTable.status, 'active'),
    ];
    if (options.organizationId) {
      conditions.push(eq(chatSessionsTable.organizationId, options.organizationId));
    }

    return this.db
      .select()
      .from(chatSessionsTable)
      .where(and(...conditions))
      .orderBy(desc(chatSessionsTable.updatedAt));
  }

  async getSession(id: string, options: ChatSessionQueryOptions): Promise<ChatSession> {
    const conditions: SQL[] = [
      eq(chatSessionsTable.id, id),
      eq(chatSessionsTable.userId, options.userId),
    ];
    if (options.organizationId) {
      conditions.push(eq(chatSessionsTable.organizationId, options.organizationId));
    }

    const [session] = await this.db
      .select()
      .from(chatSessionsTable)
      .where(and(...conditions))
      .limit(1);

    if (!session) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return session;
  }

  async getSessionInternal(id: string): Promise<ChatSession> {
    const [session] = await this.db
      .select()
      .from(chatSessionsTable)
      .where(eq(chatSessionsTable.id, id))
      .limit(1);
    if (!session) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return session;
  }

  async updateSessionTitle(
    id: string,
    title: string,
    options: ChatSessionQueryOptions,
  ): Promise<ChatSession> {
    const conditions: SQL[] = [
      eq(chatSessionsTable.id, id),
      eq(chatSessionsTable.userId, options.userId),
    ];
    if (options.organizationId) {
      conditions.push(eq(chatSessionsTable.organizationId, options.organizationId));
    }

    const [updated] = await this.db
      .update(chatSessionsTable)
      .set({ title, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return updated;
  }

  async deleteSession(id: string, options: ChatSessionQueryOptions): Promise<void> {
    const conditions: SQL[] = [
      eq(chatSessionsTable.id, id),
      eq(chatSessionsTable.userId, options.userId),
    ];
    if (options.organizationId) {
      conditions.push(eq(chatSessionsTable.organizationId, options.organizationId));
    }

    const deleted = await this.db
      .delete(chatSessionsTable)
      .where(and(...conditions))
      .returning({ id: chatSessionsTable.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
  }

  async setTemporalWorkflowId(id: string, workflowId: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({ temporalWorkflowId: workflowId })
      .where(eq(chatSessionsTable.id, id));
  }

  async touchSession(id: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({ updatedAt: sql`now()` })
      .where(eq(chatSessionsTable.id, id));
  }

  async setProcessingStatus(id: string, status: 'idle' | 'processing' | 'stopping'): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({ processingStatus: status, updatedAt: sql`now()` })
      .where(eq(chatSessionsTable.id, id));
  }

  async setActiveTurn(
    id: string,
    input: {
      turnId: string | null;
      generationId?: number | null;
      processingStatus?: 'idle' | 'processing';
    },
  ): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({
        activeTurnId: input.turnId,
        ...(input.generationId === undefined
          ? {}
          : { activeGenerationId: Math.max(0, Number(input.generationId ?? 0)) }),
        ...(input.processingStatus ? { processingStatus: input.processingStatus } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessionsTable.id, id));
  }

  async bumpGeneration(id: string): Promise<number> {
    const [updated] = await this.db
      .update(chatSessionsTable)
      .set({
        activeGenerationId: sql`${chatSessionsTable.activeGenerationId} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessionsTable.id, id))
      .returning({ activeGenerationId: chatSessionsTable.activeGenerationId });

    if (!updated) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }
    return Number(updated.activeGenerationId ?? 0);
  }

  async startRun(id: string, runId: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({
        processingStatus: 'processing',
        activeRunId: runId,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessionsTable.id, id));
  }

  async setSteerIntent(id: string, targetTurnId: string | null): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({
        steerTargetTurnId: targetTurnId,
        steerRequestedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessionsTable.id, id));
  }

  async clearSteerIntent(id: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({
        steerTargetTurnId: null,
        steerRequestedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessionsTable.id, id));
  }

  async completeRun(id: string, runId?: string): Promise<void> {
    const conditions: SQL[] = [eq(chatSessionsTable.id, id)];
    if (runId) {
      conditions.push(eq(chatSessionsTable.activeRunId, runId));
    }
    await this.db
      .update(chatSessionsTable)
      .set({
        processingStatus: 'idle',
        activeRunId: null,
        activeTurnId: null,
        updatedAt: sql`now()`,
      })
      .where(and(...conditions));
  }

  async findStaleProcessingSessions(olderThanMinutes: number): Promise<ChatSession[]> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return this.db
      .select()
      .from(chatSessionsTable)
      .where(
        and(
          eq(chatSessionsTable.processingStatus, 'processing'),
          lt(chatSessionsTable.updatedAt, cutoff),
        ),
      );
  }
}
