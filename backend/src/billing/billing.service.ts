import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { OrganizationSettingsService } from '../analytics/organization-settings.service';
import { BillingRepository } from './billing.repository';
import { LiteLLMClientService } from './litellm-client.service';
import { SubscriptionPlansService } from './subscription-plans.service';

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

@Injectable()
export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly orgSettingsService: OrganizationSettingsService,
    private readonly plansService: SubscriptionPlansService,
    private readonly litellm: LiteLLMClientService,
  ) {}

  async getUsage(auth: AuthContext) {
    if (!auth.organizationId) {
      throw new Error('Organization ID missing in context');
    }

    const now = new Date();
    const start = startOfUtcMonth(now);
    const end = addUtcMonths(start, 1);

    const settings = await this.orgSettingsService.getOrganizationSettings(auth.organizationId);
    const plan = await this.plansService.getPlanByTier(settings.subscriptionTier);

    const [workflowRunsUsed, aiSpentUsd] = await Promise.all([
      this.repository.countWorkflowRunsForPeriod({
        organizationId: auth.organizationId,
        start,
        end,
      }),
      this.litellm.getTeamSpend(auth.organizationId, start, end),
    ]);

    const isUnlimited = plan.workflowRunsPerMonth === -1;
    const workflowRunsRemaining = isUnlimited
      ? -1
      : Math.max(0, plan.workflowRunsPerMonth - workflowRunsUsed);

    const aiBudgetUsd = plan.aiBudgetUsdCents === -1 ? -1 : plan.aiBudgetUsdCents / 100;
    const aiRemainingUsd = aiBudgetUsd === -1 ? -1 : Math.max(0, aiBudgetUsd - aiSpentUsd);

    return {
      organizationId: auth.organizationId,
      subscriptionTier: settings.subscriptionTier,
      plan: {
        id: plan.id,
        displayName: plan.displayName,
        priceUsdCents: plan.priceUsdCents,
      },
      period: { start: start.toISOString(), end: end.toISOString() },
      workflowRuns: {
        used: workflowRunsUsed,
        limit: plan.workflowRunsPerMonth,
        remaining: workflowRunsRemaining,
      },
      ai: {
        spentUsd: aiSpentUsd,
        budgetUsd: aiBudgetUsd,
        remainingUsd: aiRemainingUsd,
      },
      limits: {
        maxConcurrentRuns: plan.maxConcurrentRuns,
        maxWorkflows: plan.maxWorkflows,
        analyticsRetentionDays: plan.analyticsRetentionDays,
      },
    };
  }
}
