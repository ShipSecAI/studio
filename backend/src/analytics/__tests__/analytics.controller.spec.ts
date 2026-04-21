import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { AnalyticsController } from '../analytics.controller';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';
import type { SecurityAnalyticsService } from '../security-analytics.service';
import type { OrganizationSettingsService } from '../organization-settings.service';
import type { BillingProvider, BillingUsageSummary } from '@shipsec/shared';

const TEST_ORG_ID = 'org-123';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-15T00:00:00.000Z');

const adminAuth: AuthContext = {
  userId: 'user-1',
  organizationId: TEST_ORG_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const baseSettings = {
  organizationId: TEST_ORG_ID,
  analyticsRetentionDays: 30,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

function createUsageSummary(overrides: Partial<BillingUsageSummary> = {}): BillingUsageSummary {
  return {
    organizationId: TEST_ORG_ID,
    subscriptionTier: 'team',
    plan: {
      id: 'team',
      displayName: 'Team',
      priceUsdCents: 9900,
    },
    period: {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-02-01T00:00:00.000Z',
    },
    workflowRuns: {
      used: 10,
      limit: 100,
      remaining: 90,
    },
    ai: {
      spentUsd: 1,
      budgetUsd: 100,
      remainingUsd: 99,
    },
    limits: {
      maxConcurrentRuns: 5,
      maxWorkflows: 20,
      analyticsRetentionDays: 180,
    },
    ...overrides,
  };
}

describe('AnalyticsController analytics settings', () => {
  let organizationSettingsService: {
    getOrganizationSettings: ReturnType<typeof vi.fn>;
    updateOrganizationSettings: ReturnType<typeof vi.fn>;
    validateRetentionPeriod: ReturnType<typeof vi.fn>;
    getMaxRetentionDays: ReturnType<typeof vi.fn>;
  };
  let billingProvider: {
    isConfigured: ReturnType<typeof vi.fn>;
    getUsageSummary: ReturnType<typeof vi.fn>;
    listPlans: ReturnType<typeof vi.fn>;
  };
  let controller: AnalyticsController;

  beforeEach(() => {
    organizationSettingsService = {
      getOrganizationSettings: vi.fn().mockResolvedValue(baseSettings),
      updateOrganizationSettings: vi.fn().mockResolvedValue({
        ...baseSettings,
        analyticsRetentionDays: 60,
        updatedAt: new Date('2026-01-20T00:00:00.000Z'),
      }),
      validateRetentionPeriod: vi.fn().mockReturnValue(true),
      getMaxRetentionDays: vi.fn().mockReturnValue(365),
    };

    billingProvider = {
      isConfigured: vi.fn().mockReturnValue(false),
      getUsageSummary: vi.fn(),
      listPlans: vi.fn().mockResolvedValue([]),
    };

    controller = new AnalyticsController(
      {} as SecurityAnalyticsService,
      organizationSettingsService as unknown as OrganizationSettingsService,
      { record: vi.fn() } as unknown as AuditLogService,
      billingProvider as unknown as BillingProvider,
    );
  });

  it('returns single-tenant defaults in the public build when billing is not configured', async () => {
    const result = await controller.getAnalyticsSettings(adminAuth);

    expect(organizationSettingsService.getOrganizationSettings).toHaveBeenCalledWith(TEST_ORG_ID);
    expect(organizationSettingsService.getMaxRetentionDays).toHaveBeenCalledTimes(1);
    expect(billingProvider.getUsageSummary).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      organizationId: TEST_ORG_ID,
      analyticsRetentionDays: 30,
      maxRetentionDays: 365,
      planId: null,
      planName: null,
      subscriptionTier: null,
      limitSource: 'single_tenant',
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it('surfaces plan-derived retention data when the cloud billing provider is configured', async () => {
    billingProvider.isConfigured.mockReturnValue(true);
    billingProvider.getUsageSummary.mockResolvedValue(
      createUsageSummary({
        subscriptionTier: 'enterprise',
        plan: {
          id: 'enterprise',
          displayName: 'Enterprise',
          priceUsdCents: 49900,
        },
        limits: {
          maxConcurrentRuns: 20,
          maxWorkflows: 200,
          analyticsRetentionDays: 365,
        },
      }),
    );

    const result = await controller.getAnalyticsSettings(adminAuth);

    expect(billingProvider.getUsageSummary).toHaveBeenCalledWith({ organizationId: TEST_ORG_ID });
    expect(result).toMatchObject({
      maxRetentionDays: 365,
      planId: 'enterprise',
      planName: 'Enterprise',
      subscriptionTier: 'enterprise',
      limitSource: 'plan',
    });
  });

  it('enforces the plan-derived retention cap when updating analytics settings', async () => {
    billingProvider.isConfigured.mockReturnValue(true);
    billingProvider.getUsageSummary.mockResolvedValue(
      createUsageSummary({
        limits: {
          maxConcurrentRuns: 5,
          maxWorkflows: 20,
          analyticsRetentionDays: 90,
        },
      }),
    );

    await expect(
      controller.updateAnalyticsSettings(adminAuth, { analyticsRetentionDays: 120 }),
    ).rejects.toThrow('Retention period of 120 days exceeds the allowed maximum (90 days)');

    expect(organizationSettingsService.updateOrganizationSettings).not.toHaveBeenCalled();
  });

  it('returns plan metadata after a successful update so all consumers keep the same contract', async () => {
    billingProvider.isConfigured.mockReturnValue(true);
    billingProvider.getUsageSummary.mockResolvedValue(createUsageSummary());

    const result = await controller.updateAnalyticsSettings(adminAuth, {
      analyticsRetentionDays: 60,
    });

    expect(organizationSettingsService.validateRetentionPeriod).toHaveBeenCalledWith(60);
    expect(organizationSettingsService.updateOrganizationSettings).toHaveBeenCalledWith(
      TEST_ORG_ID,
      { analyticsRetentionDays: 60 },
    );
    expect(result).toMatchObject({
      analyticsRetentionDays: 60,
      maxRetentionDays: 180,
      planId: 'team',
      planName: 'Team',
      subscriptionTier: 'team',
      limitSource: 'plan',
    });
  });
});
