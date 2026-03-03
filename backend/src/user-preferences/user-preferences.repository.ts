import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { userPreferencesTable } from '../database/schema';

export interface UserPreferencesData {
  hasCompletedOnboarding: boolean;
  hasCompletedBuilderTour: boolean;
}

@Injectable()
export class UserPreferencesRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async findByUserAndOrg(
    userId: string,
    organizationId: string,
  ): Promise<UserPreferencesData | null> {
    const rows = await this.db
      .select({
        hasCompletedOnboarding: userPreferencesTable.hasCompletedOnboarding,
        hasCompletedBuilderTour: userPreferencesTable.hasCompletedBuilderTour,
      })
      .from(userPreferencesTable)
      .where(
        and(
          eq(userPreferencesTable.userId, userId),
          eq(userPreferencesTable.organizationId, organizationId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    userId: string,
    organizationId: string,
    updates: Partial<UserPreferencesData>,
  ): Promise<UserPreferencesData> {
    const [result] = await this.db
      .insert(userPreferencesTable)
      .values({
        userId,
        organizationId,
        hasCompletedOnboarding: updates.hasCompletedOnboarding ?? false,
        hasCompletedBuilderTour: updates.hasCompletedBuilderTour ?? false,
      })
      .onConflictDoUpdate({
        target: [userPreferencesTable.userId, userPreferencesTable.organizationId],
        set: {
          ...(updates.hasCompletedOnboarding !== undefined
            ? { hasCompletedOnboarding: updates.hasCompletedOnboarding }
            : {}),
          ...(updates.hasCompletedBuilderTour !== undefined
            ? { hasCompletedBuilderTour: updates.hasCompletedBuilderTour }
            : {}),
          updatedAt: sql`now()`,
        },
      })
      .returning({
        hasCompletedOnboarding: userPreferencesTable.hasCompletedOnboarding,
        hasCompletedBuilderTour: userPreferencesTable.hasCompletedBuilderTour,
      });

    return result;
  }
}
