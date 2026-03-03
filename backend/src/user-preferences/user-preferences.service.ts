import { Injectable, BadRequestException } from '@nestjs/common';

import { UserPreferencesRepository, type UserPreferencesData } from './user-preferences.repository';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

@Injectable()
export class UserPreferencesService {
  constructor(private readonly repository: UserPreferencesRepository) {}

  private resolveIds(auth: AuthContext | null): { userId: string; organizationId: string } {
    const userId = auth?.userId;
    if (!userId) {
      throw new BadRequestException('User context is required');
    }
    const organizationId = auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
    return { userId, organizationId };
  }

  async getPreferences(auth: AuthContext | null): Promise<UserPreferencesData> {
    const { userId, organizationId } = this.resolveIds(auth);
    const prefs = await this.repository.findByUserAndOrg(userId, organizationId);
    return prefs ?? { hasCompletedOnboarding: false, hasCompletedBuilderTour: false };
  }

  async updatePreferences(
    auth: AuthContext | null,
    updates: Partial<UserPreferencesData>,
  ): Promise<UserPreferencesData> {
    const { userId, organizationId } = this.resolveIds(auth);
    return this.repository.upsert(userId, organizationId, updates);
  }
}
