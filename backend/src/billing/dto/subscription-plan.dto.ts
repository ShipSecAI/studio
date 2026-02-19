import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionPlanDto {
  @ApiProperty({ example: 'pro' })
  id!: string;

  @ApiProperty({ example: 'Pro' })
  displayName!: string;

  @ApiProperty({ example: 4900, description: 'Monthly price in USD cents (0 = free or custom)' })
  priceUsdCents!: number;

  @ApiProperty({ example: 500, description: '-1 means unlimited' })
  workflowRunsPerMonth!: number;

  @ApiProperty({ example: 5000, description: 'AI budget in USD cents (-1 = unlimited)' })
  aiBudgetUsdCents!: number;

  @ApiProperty({ example: 3, description: '-1 means unlimited' })
  maxConcurrentRuns!: number;

  @ApiProperty({ example: 30 })
  analyticsRetentionDays!: number;

  @ApiProperty({ example: -1, description: '-1 means unlimited' })
  maxWorkflows!: number;
}
