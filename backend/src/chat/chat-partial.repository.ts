import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatPartialResponsesTable } from '../database/schema';

@Injectable()
export class ChatPartialRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsert(sessionId: string, parts: unknown[]): Promise<void> {
    await this.db
      .insert(chatPartialResponsesTable)
      .values({ sessionId, parts, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: chatPartialResponsesTable.sessionId,
        set: { parts, updatedAt: new Date() },
      });
  }

  async get(sessionId: string): Promise<{ parts: unknown[]; updatedAt: Date } | null> {
    const [row] = await this.db
      .select()
      .from(chatPartialResponsesTable)
      .where(eq(chatPartialResponsesTable.sessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    await this.db
      .delete(chatPartialResponsesTable)
      .where(eq(chatPartialResponsesTable.sessionId, sessionId));
  }
}
