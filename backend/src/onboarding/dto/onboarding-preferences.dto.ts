import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class OnboardingPreferencesDto {
  @ApiProperty({ example: true })
  appNavigationTourCompleted!: boolean;

  @ApiProperty({ example: false })
  workflowBuilderTourCompleted!: boolean;
}

export class UpdateOnboardingPreferencesDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  appNavigationTourCompleted?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  workflowBuilderTourCompleted?: boolean;
}
