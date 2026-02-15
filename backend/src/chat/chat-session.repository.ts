import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  chatSessionsTable,
  type ChatSession,
  chatMessagesTable,
  type ChatMessage,
} from '../database/schema';

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

  async touchSession(id: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({ updatedAt: sql`now()` })
      .where(eq(chatSessionsTable.id, id));
  }

  async saveMessage(
    sessionId: string,
    message: { role: string; parts: unknown[] },
  ): Promise<ChatMessage> {
    const [saved] = await this.db
      .insert(chatMessagesTable)
      .values({
        sessionId,
        role: message.role,
        parts: message.parts,
      })
      .returning();
    return saved;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, sessionId))
      .orderBy(chatMessagesTable.createdAt);
  }
}
