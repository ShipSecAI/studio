import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubscriptionPlanSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  priceUsdCents: z.number().describe('Monthly price in USD cents (0 = free or custom)'),
  workflowRunsPerMonth: z.number().describe('-1 means unlimited'),
  aiBudgetUsdCents: z.number().describe('AI budget in USD cents (-1 = unlimited)'),
  maxConcurrentRuns: z.number().describe('-1 means unlimited'),
  analyticsRetentionDays: z.number(),
  maxWorkflows: z.number().describe('-1 means unlimited'),
});
export class SubscriptionPlanDto extends createZodDto(SubscriptionPlanSchema) {}
