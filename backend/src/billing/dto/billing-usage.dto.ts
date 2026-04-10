import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BillingPlanSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  priceUsdCents: z.number().describe('Monthly price in USD cents'),
});
export class BillingPlanSummaryDto extends createZodDto(BillingPlanSummarySchema) {}

export const BillingPeriodSchema = z.object({
  start: z.string(),
  end: z.string(),
});
export class BillingPeriodDto extends createZodDto(BillingPeriodSchema) {}

export const BillingMeterSchema = z.object({
  used: z.number(),
  limit: z.number().describe('-1 means unlimited'),
  remaining: z.number().describe('-1 means unlimited'),
});
export class BillingMeterDto extends createZodDto(BillingMeterSchema) {}

export const BillingAiUsageSchema = z.object({
  spentUsd: z.number().describe('USD spent via Bifrost this period'),
  budgetUsd: z.number().describe('Budget in USD (-1 = unlimited)'),
  remainingUsd: z.number().describe('Remaining budget (-1 = unlimited)'),
});
export class BillingAiUsageDto extends createZodDto(BillingAiUsageSchema) {}

export const BillingLimitsSchema = z.object({
  maxConcurrentRuns: z.number().describe('-1 means unlimited'),
  maxWorkflows: z.number().describe('-1 means unlimited'),
  analyticsRetentionDays: z.number(),
});
export class BillingLimitsDto extends createZodDto(BillingLimitsSchema) {}

export const BillingUsageResponseSchema = z.object({
  organizationId: z.string(),
  subscriptionTier: z.enum(['free', 'pro', 'team', 'enterprise']),
  plan: BillingPlanSummarySchema,
  period: BillingPeriodSchema,
  workflowRuns: BillingMeterSchema,
  ai: BillingAiUsageSchema,
  limits: BillingLimitsSchema,
});
export class BillingUsageResponseDto extends createZodDto(BillingUsageResponseSchema) {}
