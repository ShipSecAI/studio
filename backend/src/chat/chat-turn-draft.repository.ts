import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { chatTurnDraftsTable } from '../database/schema';

@Injectable()
export class ChatTurnDraftRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsert(turnId: string, assistantMessageSnapshot: Record<string, unknown>, lastSeq: number) {
    await this.db
      .insert(chatTurnDraftsTable)
      .values({
        turnId,
        assistantMessageSnapshot,
        lastSeq,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: chatTurnDraftsTable.turnId,
        set: {
          assistantMessageSnapshot,
          lastSeq,
          updatedAt: new Date(),
        },
      });
  }

  async get(turnId: string) {
    const [row] = await this.db
      .select()
      .from(chatTurnDraftsTable)
      .where(eq(chatTurnDraftsTable.turnId, turnId))
      .limit(1);

    return row ?? null;
  }
}
