import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiHeader } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { AnalyticsQueryRequestDto, AnalyticsQueryResponseDto } from './dto/analytics-query.dto';
import {
  AnalyticsSettingsResponseDto,
  UpdateAnalyticsSettingsDto,
  TIER_LIMITS,
} from './dto/analytics-settings.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

const MAX_QUERY_SIZE = 1000;
const MAX_QUERY_FROM = 10000;

function isValidNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly organizationSettingsService: OrganizationSettingsService,
  ) {}

  @Post('query')
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute per user
  @ApiOkResponse({
    description: 'Query analytics data for the authenticated organization',
    type: AnalyticsQueryResponseDto,
  })
  @ApiHeader({
    name: 'X-RateLimit-Limit',
    description: 'Maximum number of requests allowed per minute',
    schema: { type: 'integer', example: 100 },
  })
  @ApiHeader({
    name: 'X-RateLimit-Remaining',
    description: 'Number of requests remaining in the current time window',
    schema: { type: 'integer', example: 99 },
  })
  async queryAnalytics(
    @CurrentAuth() auth: AuthContext | null,
    @Body() queryDto: AnalyticsQueryRequestDto,
  ): Promise<AnalyticsQueryResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Validate query syntax
    if (queryDto.query && typeof queryDto.query !== 'object') {
      throw new BadRequestException('Invalid query syntax: query must be an object');
    }

    if (queryDto.aggs && typeof queryDto.aggs !== 'object') {
      throw new BadRequestException('Invalid query syntax: aggs must be an object');
    }

    // Set defaults
    const size = queryDto.size ?? 10;
    const from = queryDto.from ?? 0;

    if (!isValidNonNegativeInt(size)) {
      throw new BadRequestException('Invalid size: must be a non-negative integer');
    }

    if (!isValidNonNegativeInt(from)) {
      throw new BadRequestException('Invalid from: must be a non-negative integer');
    }

    if (size > MAX_QUERY_SIZE) {
      throw new BadRequestException(`Invalid size: maximum is ${MAX_QUERY_SIZE}`);
    }

    if (from > MAX_QUERY_FROM) {
      throw new BadRequestException(`Invalid from: maximum is ${MAX_QUERY_FROM}`);
    }

    // Call the service to execute the query
    return this.securityAnalyticsService.query(auth.organizationId, {
      query: queryDto.query,
      size,
      from,
      aggs: queryDto.aggs,
    });
  }

  @Get('settings')
  @ApiOkResponse({
    description: 'Get analytics settings for the authenticated organization',
    type: AnalyticsSettingsResponseDto,
  })
  async getAnalyticsSettings(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<AnalyticsSettingsResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Get or create organization settings
    const settings = await this.organizationSettingsService.getOrganizationSettings(
      auth.organizationId,
    );

    // Get max retention days for tier
    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays(
      settings.subscriptionTier,
    );

    return {
      organizationId: settings.organizationId,
      subscriptionTier: settings.subscriptionTier,
      analyticsRetentionDays: settings.analyticsRetentionDays,
      maxRetentionDays,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  @Put('settings')
  @ApiOkResponse({
    description: 'Update analytics settings for the authenticated organization',
    type: AnalyticsSettingsResponseDto,
  })
  async updateAnalyticsSettings(
    @CurrentAuth() auth: AuthContext | null,
    @Body() updateDto: UpdateAnalyticsSettingsDto,
  ): Promise<AnalyticsSettingsResponseDto> {
    // Require authentication
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    // Require organization context
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    // Only org admins can update settings
    if (!auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only organization admins can update analytics settings');
    }

    // Get current settings to validate against tier
    const currentSettings = await this.organizationSettingsService.getOrganizationSettings(
      auth.organizationId,
    );

    // Determine the tier to validate against (use new tier if provided, otherwise current)
    const tierToValidate = updateDto.subscriptionTier ?? currentSettings.subscriptionTier;

    // Validate retention period is within tier limits
    if (updateDto.analyticsRetentionDays !== undefined) {
      if (
        typeof updateDto.analyticsRetentionDays !== 'number' ||
        !Number.isInteger(updateDto.analyticsRetentionDays)
      ) {
        throw new BadRequestException('Retention period must be an integer number of days');
      }

      const isValid = this.organizationSettingsService.validateRetentionPeriod(
        tierToValidate,
        updateDto.analyticsRetentionDays,
      );

      if (!isValid) {
        const maxDays = TIER_LIMITS[tierToValidate].maxRetentionDays;
        throw new BadRequestException(
          `Retention period of ${updateDto.analyticsRetentionDays} days exceeds the limit for ${TIER_LIMITS[tierToValidate].name} tier (${maxDays} days)`,
        );
      }
    }

    // Update settings
    const updated = await this.organizationSettingsService.updateOrganizationSettings(
      auth.organizationId,
      {
        analyticsRetentionDays: updateDto.analyticsRetentionDays,
        subscriptionTier: updateDto.subscriptionTier,
      },
    );

    // Get max retention days for updated tier
    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays(
      updated.subscriptionTier,
    );

    return {
      organizationId: updated.organizationId,
      subscriptionTier: updated.subscriptionTier,
      analyticsRetentionDays: updated.analyticsRetentionDays,
      maxRetentionDays,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
