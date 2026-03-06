import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import type { AuthContext } from '../auth/types';
import {
  OnboardingPreferencesDto,
  UpdateOnboardingPreferencesDto,
} from './dto/onboarding-preferences.dto';

type UserSettingsRow = Pick<
  typeof schema.userSettingsTable.$inferSelect,
  'awsExternalId' | 'appNavigationTourCompleted' | 'workflowBuilderTourCompleted'
>;

@Injectable()
export class OnboardingService {
  constructor(@Inject(DRIZZLE_TOKEN) private readonly db: NodePgDatabase<typeof schema>) {}

  async getPreferences(auth: AuthContext | null): Promise<OnboardingPreferencesDto> {
    const userId = this.requireUserId(auth);
    const [record] = await this.db
      .select({
        appNavigationTourCompleted: schema.userSettingsTable.appNavigationTourCompleted,
        workflowBuilderTourCompleted: schema.userSettingsTable.workflowBuilderTourCompleted,
      })
      .from(schema.userSettingsTable)
      .where(eq(schema.userSettingsTable.userId, userId))
      .limit(1);

    return {
      appNavigationTourCompleted: record?.appNavigationTourCompleted ?? false,
      workflowBuilderTourCompleted: record?.workflowBuilderTourCompleted ?? false,
    };
  }

  async updatePreferences(
    auth: AuthContext | null,
    updates: UpdateOnboardingPreferencesDto,
  ): Promise<OnboardingPreferencesDto> {
    const userId = this.requireUserId(auth);
    const existing = await this.getExistingSettings(userId);

    const nextPreferences: OnboardingPreferencesDto = {
      appNavigationTourCompleted:
        updates.appNavigationTourCompleted ?? existing?.appNavigationTourCompleted ?? false,
      workflowBuilderTourCompleted:
        updates.workflowBuilderTourCompleted ?? existing?.workflowBuilderTourCompleted ?? false,
    };

    const [record] = await this.db
      .insert(schema.userSettingsTable)
      .values({
        userId,
        awsExternalId: existing?.awsExternalId ?? null,
        appNavigationTourCompleted: nextPreferences.appNavigationTourCompleted,
        workflowBuilderTourCompleted: nextPreferences.workflowBuilderTourCompleted,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.userSettingsTable.userId,
        set: {
          appNavigationTourCompleted: nextPreferences.appNavigationTourCompleted,
          workflowBuilderTourCompleted: nextPreferences.workflowBuilderTourCompleted,
          updatedAt: new Date(),
        },
      })
      .returning({
        appNavigationTourCompleted: schema.userSettingsTable.appNavigationTourCompleted,
        workflowBuilderTourCompleted: schema.userSettingsTable.workflowBuilderTourCompleted,
      });

    return {
      appNavigationTourCompleted: record?.appNavigationTourCompleted ?? false,
      workflowBuilderTourCompleted: record?.workflowBuilderTourCompleted ?? false,
    };
  }

  private async getExistingSettings(userId: string): Promise<UserSettingsRow | null> {
    const [record] = await this.db
      .select({
        awsExternalId: schema.userSettingsTable.awsExternalId,
        appNavigationTourCompleted: schema.userSettingsTable.appNavigationTourCompleted,
        workflowBuilderTourCompleted: schema.userSettingsTable.workflowBuilderTourCompleted,
      })
      .from(schema.userSettingsTable)
      .where(eq(schema.userSettingsTable.userId, userId))
      .limit(1);

    return record ?? null;
  }

  private requireUserId(auth: AuthContext | null): string {
    if (!auth?.userId) {
      throw new BadRequestException('Authenticated user context is required');
    }
    return auth.userId;
  }
}
