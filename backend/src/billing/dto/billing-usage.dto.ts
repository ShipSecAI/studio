import { ApiProperty } from '@nestjs/swagger';

export class BillingPlanSummaryDto {
  @ApiProperty({ example: 'pro' })
  id!: string;

  @ApiProperty({ example: 'Pro' })
  displayName!: string;

  @ApiProperty({ example: 4900, description: 'Monthly price in USD cents' })
  priceUsdCents!: number;
}

export class BillingPeriodDto {
  @ApiProperty({ example: '2026-02-01T00:00:00.000Z' })
  start!: string;

  @ApiProperty({ example: '2026-03-01T00:00:00.000Z' })
  end!: string;
}

export class BillingMeterDto {
  @ApiProperty({ example: 42 })
  used!: number;

  @ApiProperty({ example: 500, description: '-1 means unlimited' })
  limit!: number;

  @ApiProperty({ example: 458, description: '-1 means unlimited' })
  remaining!: number;
}

export class BillingAiUsageDto {
  @ApiProperty({ example: 12.5, description: 'USD spent via LiteLLM this period' })
  spentUsd!: number;

  @ApiProperty({ example: 50, description: 'Budget in USD (-1 = unlimited)' })
  budgetUsd!: number;

  @ApiProperty({ example: 37.5, description: 'Remaining budget (-1 = unlimited)' })
  remainingUsd!: number;

  @ApiProperty({ example: 125000, description: 'Total tokens consumed (informational)' })
  totalTokensUsed!: number;
}

export class BillingLimitsDto {
  @ApiProperty({ example: 3, description: '-1 means unlimited' })
  maxConcurrentRuns!: number;

  @ApiProperty({ example: -1, description: '-1 means unlimited' })
  maxWorkflows!: number;

  @ApiProperty({ example: 30 })
  analyticsRetentionDays!: number;
}

export class BillingUsageResponseDto {
  @ApiProperty({ example: 'org_abc123' })
  organizationId!: string;

  @ApiProperty({ enum: ['free', 'pro', 'team', 'enterprise'], example: 'pro' })
  subscriptionTier!: string;

  @ApiProperty({ type: BillingPlanSummaryDto })
  plan!: BillingPlanSummaryDto;

  @ApiProperty({ type: BillingPeriodDto })
  period!: BillingPeriodDto;

  @ApiProperty({ type: BillingMeterDto })
  workflowRuns!: BillingMeterDto;

  @ApiProperty({ type: BillingAiUsageDto })
  ai!: BillingAiUsageDto;

  @ApiProperty({ type: BillingLimitsDto })
  limits!: BillingLimitsDto;
}
