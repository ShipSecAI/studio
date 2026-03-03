import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateUserPreferencesDto {
  @ApiPropertyOptional({ description: 'Whether the user has completed the onboarding tour' })
  @IsOptional()
  @IsBoolean()
  hasCompletedOnboarding?: boolean;

  @ApiPropertyOptional({ description: 'Whether the user has completed the workflow builder tour' })
  @IsOptional()
  @IsBoolean()
  hasCompletedBuilderTour?: boolean;
}

export class UserPreferencesResponseDto {
  @ApiProperty()
  hasCompletedOnboarding!: boolean;

  @ApiProperty()
  hasCompletedBuilderTour!: boolean;
}
