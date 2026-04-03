import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  slackTurnPostsTable,
  type NewSlackTurnPost,
  type SlackTurnPost,
} from '../database/schema/slack-turn-posts';

@Injectable()
export class SlackTurnPostRepository {
  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  async reserve(sessionId: string, turnId: string): Promise<SlackTurnPost> {
    const [inserted] = await this.db
      .insert(slackTurnPostsTable)
      .values({ sessionId, turnId } satisfies NewSlackTurnPost)
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      return inserted;
    }

    const existing = await this.findByTurnId(turnId);
    if (!existing) {
      throw new Error(`Failed to reserve Slack turn post for turn ${turnId}`);
    }
    return existing;
  }

  async findByTurnId(turnId: string): Promise<SlackTurnPost | null> {
    const [row] = await this.db
      .select()
      .from(slackTurnPostsTable)
      .where(eq(slackTurnPostsTable.turnId, turnId))
      .limit(1);
    return row ?? null;
  }

  async saveMessages(
    turnId: string,
    input: {
      primaryMessageTs: string;
      continuationMessageTs: string[];
      lastContentHash: string;
    },
  ): Promise<void> {
    await this.db
      .update(slackTurnPostsTable)
      .set({
        primaryMessageTs: input.primaryMessageTs,
        continuationMessageTs: input.continuationMessageTs,
        lastContentHash: input.lastContentHash,
        updatedAt: sql`now()`,
      })
      .where(eq(slackTurnPostsTable.turnId, turnId));
  }
}
