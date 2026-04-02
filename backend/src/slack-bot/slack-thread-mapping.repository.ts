import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  slackThreadMappingsTable,
  type NewSlackThreadMapping,
  type SlackThreadMapping,
} from '../database/schema/slack-thread-mappings';
import { chatSessionsTable } from '../database/schema/chat-sessions';

@Injectable()
export class SlackThreadMappingRepository {
  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase) {}

  async create(data: NewSlackThreadMapping): Promise<SlackThreadMapping> {
    const [row] = await this.db.insert(slackThreadMappingsTable).values(data).returning();
    return row;
  }

  async findByThread(
    teamId: string,
    channelId: string,
    threadTs: string,
  ): Promise<SlackThreadMapping | null> {
    const [row] = await this.db
      .select()
      .from(slackThreadMappingsTable)
      .where(
        and(
          eq(slackThreadMappingsTable.slackTeamId, teamId),
          eq(slackThreadMappingsTable.slackChannelId, channelId),
          eq(slackThreadMappingsTable.slackThreadTs, threadTs),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findBySessionId(sessionId: string): Promise<SlackThreadMapping | null> {
    const [row] = await this.db
      .select()
      .from(slackThreadMappingsTable)
      .where(eq(slackThreadMappingsTable.sessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async findAllActiveMappings(): Promise<SlackThreadMapping[]> {
    return this.db
      .select({ mapping: slackThreadMappingsTable })
      .from(slackThreadMappingsTable)
      .innerJoin(chatSessionsTable, eq(slackThreadMappingsTable.sessionId, chatSessionsTable.id))
      .where(eq(chatSessionsTable.status, 'active'))
      .then((rows) => rows.map((r) => r.mapping));
  }

  async setSessionOrigin(sessionId: string, origin: string): Promise<void> {
    await this.db
      .update(chatSessionsTable)
      .set({ origin })
      .where(eq(chatSessionsTable.id, sessionId));
  }
}
