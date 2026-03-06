import { describe, expect, it, mock } from 'bun:test';

import { OnboardingService } from '../onboarding.service';
import type { AuthContext } from '../../auth/types';

const auth: AuthContext = {
  userId: 'user-123',
  organizationId: 'org-123',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'clerk',
};

function createDb(selectResult: unknown[], returningResult: unknown[] = []) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        onConflictDoUpdate: mock(() => ({
          returning: mock(() => Promise.resolve(returningResult)),
        })),
      })),
    })),
  };
}

describe('OnboardingService', () => {
  it('returns defaults when the user has no stored preferences', async () => {
    const db = createDb([]);
    const service = new OnboardingService(db as any);

    await expect(service.getPreferences(auth)).resolves.toEqual({
      appNavigationTourCompleted: false,
      workflowBuilderTourCompleted: false,
    });
  });

  it('returns persisted preferences when present', async () => {
    const db = createDb([
      {
        appNavigationTourCompleted: true,
        workflowBuilderTourCompleted: false,
      },
    ]);
    const service = new OnboardingService(db as any);

    await expect(service.getPreferences(auth)).resolves.toEqual({
      appNavigationTourCompleted: true,
      workflowBuilderTourCompleted: false,
    });
  });

  it('merges updates with existing settings before upsert', async () => {
    const db = createDb(
      [
        {
          awsExternalId: 'aws-ext-1',
          appNavigationTourCompleted: true,
          workflowBuilderTourCompleted: false,
        },
      ],
      [
        {
          appNavigationTourCompleted: true,
          workflowBuilderTourCompleted: true,
        },
      ],
    );
    const service = new OnboardingService(db as any);

    await expect(
      service.updatePreferences(auth, { workflowBuilderTourCompleted: true }),
    ).resolves.toEqual({
      appNavigationTourCompleted: true,
      workflowBuilderTourCompleted: true,
    });
  });
});
