import { describe, expect, test } from 'bun:test';

import { BillingService } from '../billing.service';

describe('BillingService', () => {
  test('returns USD-based AI spend and DB-driven plan limits', async () => {
    const repository = {
      countWorkflowRunsForPeriod: async () => 10,
      sumAiTokensForPeriod: async () => 5000,
    } as any;

    const orgSettingsService = {
      getOrganizationSettings: async () => ({ subscriptionTier: 'pro' }),
    } as any;

    const plansService = {
      getPlanByTier: async () => ({
        id: 'pro',
        displayName: 'Pro',
        priceUsdCents: 4900,
        workflowRunsPerMonth: 500,
        aiBudgetUsdCents: 5000,
        maxConcurrentRuns: 3,
        analyticsRetentionDays: 30,
        maxWorkflows: -1,
        isActive: true,
      }),
    } as any;

    const litellm = {
      getTeamSpend: async () => 12.5,
    } as any;

    const service = new BillingService(repository, orgSettingsService, plansService, litellm);

    const result = await service.getUsage({ organizationId: 'org-1' } as any);

    expect(result.subscriptionTier).toBe('pro');
    expect(result.plan.id).toBe('pro');
    expect(result.plan.priceUsdCents).toBe(4900);
    expect(result.workflowRuns.used).toBe(10);
    expect(result.workflowRuns.limit).toBe(500);
    expect(result.workflowRuns.remaining).toBe(490);
    expect(result.ai.spentUsd).toBe(12.5);
    expect(result.ai.budgetUsd).toBe(50);
    expect(result.ai.remainingUsd).toBe(37.5);
    expect(result.ai.totalTokensUsed).toBe(5000);
    expect(result.limits.maxConcurrentRuns).toBe(3);
    expect(result.limits.maxWorkflows).toBe(-1);
  });

  test('handles unlimited plans correctly (-1 values)', async () => {
    const repository = {
      countWorkflowRunsForPeriod: async () => 42,
      sumAiTokensForPeriod: async () => 100000,
    } as any;

    const orgSettingsService = {
      getOrganizationSettings: async () => ({ subscriptionTier: 'enterprise' }),
    } as any;

    const plansService = {
      getPlanByTier: async () => ({
        id: 'enterprise',
        displayName: 'Enterprise',
        priceUsdCents: 0,
        workflowRunsPerMonth: -1,
        aiBudgetUsdCents: -1,
        maxConcurrentRuns: -1,
        analyticsRetentionDays: 365,
        maxWorkflows: -1,
        isActive: true,
      }),
    } as any;

    const litellm = {
      getTeamSpend: async () => 500.0,
    } as any;

    const service = new BillingService(repository, orgSettingsService, plansService, litellm);

    const result = await service.getUsage({ organizationId: 'org-ent' } as any);

    expect(result.workflowRuns.remaining).toBe(-1);
    expect(result.ai.budgetUsd).toBe(-1);
    expect(result.ai.remainingUsd).toBe(-1);
  });
});
