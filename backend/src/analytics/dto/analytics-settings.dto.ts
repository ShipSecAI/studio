import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Min, Max, IsOptional } from 'class-validator';
import type { SubscriptionTier } from '../../database/schema/organization-settings';

export type { SubscriptionTier };

export const TIER_LIMITS: Record<SubscriptionTier, { name: string; maxRetentionDays: number }> = {
  free: { name: 'Free', maxRetentionDays: 30 },
  pro: { name: 'Pro', maxRetentionDays: 90 },
  enterprise: { name: 'Enterprise', maxRetentionDays: 365 },
};

export class AnalyticsSettingsResponseDto {
  @ApiProperty({
    description: 'Organization ID',
    example: 'org_abc123',
  })
  organizationId!: string;

  @ApiProperty({
    description: 'Subscription tier',
    enum: ['free', 'pro', 'enterprise'],
    example: 'free',
  })
  subscriptionTier!: SubscriptionTier;

  @ApiProperty({
    description: 'Data retention period in days',
    example: 30,
  })
  analyticsRetentionDays!: number;

  @ApiProperty({
    description: 'Maximum retention days allowed for this tier',
    example: 30,
  })
  maxRetentionDays!: number;

  @ApiProperty({
    description: 'Timestamp when settings were created',
    example: '2026-01-20T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when settings were last updated',
    example: '2026-01-20T00:00:00.000Z',
  })
  updatedAt!: Date;
}

export class UpdateAnalyticsSettingsDto {
  @ApiProperty({
    description: 'Data retention period in days (must be within tier limits)',
    example: 30,
    minimum: 1,
    maximum: 365,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  analyticsRetentionDays?: number;

  // Optional: allow updating subscription tier (if needed in the future)
  @ApiProperty({
    description: 'Subscription tier (optional - usually set by billing system)',
    enum: ['free', 'pro', 'enterprise'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['free', 'pro', 'enterprise'])
  subscriptionTier?: SubscriptionTier;
}
