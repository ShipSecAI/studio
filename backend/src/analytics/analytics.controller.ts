import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags, ApiHeader } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { OpenSearchTenantService } from './opensearch-tenant.service';
import {
  AnalyticsQueryRequestDto,
  AnalyticsQueryResponseDto,
  ProwlerChecksMetadataResponseDto,
  ProwlerChecksMetadataResponseSchema,
  StorageUsageResponseDto,
  PurgeDataResponseDto,
  type ProwlerChecksMetadataResponse,
} from './dto/analytics-query.dto';
import {
  AnalyticsSettingsResponseDto,
  UpdateAnalyticsSettingsDto,
  TIER_LIMITS,
} from './dto/analytics-settings.dto';
import {
  BatchRunSummariesRequestDto,
  BatchRunSummariesResponseDto,
  EnsureTenantRequestDto,
  EnsureTenantResponseDto,
} from './dto/analytics-internal.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthContext } from '../auth/types';

const MAX_QUERY_SIZE = 1000;
const MAX_QUERY_FROM = 10000;

function isValidNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  private readonly internalServiceToken: string;
  private _prowlerChecksMetadata: ProwlerChecksMetadataResponse | null = null;

  private get prowlerChecksMetadata(): ProwlerChecksMetadataResponse {
    if (!this._prowlerChecksMetadata) {
      try {
        const raw = readFileSync(join(__dirname, '..', 'assets', 'prowler-checks.json'), 'utf-8');
        const parsed = ProwlerChecksMetadataResponseSchema.safeParse(JSON.parse(raw));
        this._prowlerChecksMetadata = parsed.success ? parsed.data : {};
      } catch {
        this._prowlerChecksMetadata = {};
      }
    }
    return this._prowlerChecksMetadata!;
  }

  constructor(
    private readonly securityAnalyticsService: SecurityAnalyticsService,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly openSearchTenantService: OpenSearchTenantService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.internalServiceToken = this.configService.get<string>('INTERNAL_SERVICE_TOKEN') || '';
  }

  @Post('query')
  @HttpCode(200)
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

    // Validate collapse shape: only allow { field: string }, block inner_hits
    if (queryDto.collapse) {
      if (typeof queryDto.collapse !== 'object') {
        throw new BadRequestException('Invalid collapse: must be an object');
      }
      if ('inner_hits' in queryDto.collapse) {
        throw new BadRequestException('Invalid collapse: inner_hits is not allowed');
      }
      if (typeof queryDto.collapse.field !== 'string') {
        throw new BadRequestException('Invalid collapse: must contain a "field" string');
      }
    }

    this.auditLogService.record(auth, {
      action: 'analytics.query',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: {
        size,
        from,
        hasQuery: Boolean(queryDto.query),
        hasAggs: Boolean(queryDto.aggs),
      },
    });

    // Call the service to execute the query
    return this.securityAnalyticsService.query(auth.organizationId, {
      query: queryDto.query,
      size,
      from,
      aggs: queryDto.aggs,
      sort: queryDto.sort,
      collapse: queryDto.collapse,
      useLatest: queryDto.useLatest,
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
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
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
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  @Post('batch-run-summaries')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOkResponse({
    description: 'Get severity counts for multiple run IDs',
    type: BatchRunSummariesResponseDto,
  })
  async batchRunSummaries(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: BatchRunSummariesRequestDto,
  ): Promise<BatchRunSummariesResponseDto> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    if (!Array.isArray(body.runIds)) {
      throw new BadRequestException('runIds must be an array');
    }

    const runIds = [...new Set(body.runIds)].slice(0, 100);

    const summaries = await this.securityAnalyticsService.batchRunSeverityCounts(
      auth.organizationId,
      runIds,
    );

    return { summaries };
  }

  @Get('storage-usage')
  @ApiOkResponse({
    description: 'Get OpenSearch storage usage for the authenticated organization',
    type: StorageUsageResponseDto,
  })
  async getStorageUsage(@CurrentAuth() auth: AuthContext | null): Promise<{
    usedBytes: number;
    documentCount: number;
    indexCount: number;
    opensearchEnabled: boolean;
  }> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
    return this.securityAnalyticsService.getStorageUsage(auth.organizationId);
  }

  @Delete('data')
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Purge all analytics data for the authenticated organization',
    type: PurgeDataResponseDto,
  })
  async purgeData(@CurrentAuth() auth: AuthContext | null): Promise<{ deletedIndices: number }> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
    if (!auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only organization admins can purge analytics data');
    }
    return this.securityAnalyticsService.purgeOrgData(auth.organizationId);
  }

  @Get('prowler-checks-metadata')
  @SkipThrottle()
  @Header('Cache-Control', 'public, max-age=2592000')
  @ApiOkResponse({
    description: 'Static Prowler check metadata keyed by CheckID',
    type: ProwlerChecksMetadataResponseDto,
  })
  async getProwlerChecksMetadata(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<ProwlerChecksMetadataResponse> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    return this.prowlerChecksMetadata;
  }

  /**
   * Ensure tenant resources exist for an organization.
   * Called by worker before indexing to ensure tenant isolation is set up.
   *
   * Requires X-Internal-Token header for authentication (internal service-to-service).
   * This endpoint is idempotent - safe to call multiple times.
   */
  @Public()
  @SkipThrottle()
  @Post('ensure-tenant')
  @ApiOkResponse({
    description: 'Ensure tenant resources exist for organization',
    type: EnsureTenantResponseDto,
  })
  async ensureTenant(
    @Headers('x-internal-token') internalToken: string | undefined,
    @Body() body: EnsureTenantRequestDto,
  ): Promise<EnsureTenantResponseDto> {
    // Validate internal service token
    if (!this.internalServiceToken) {
      // Token not configured - allow in dev mode but log warning
      console.warn('[ensureTenant] INTERNAL_SERVICE_TOKEN not configured');
    } else if (internalToken !== this.internalServiceToken) {
      throw new UnauthorizedException('Invalid internal service token');
    }

    // Validate request body
    if (!body.organizationId || typeof body.organizationId !== 'string') {
      throw new BadRequestException('organizationId is required');
    }

    const orgId = body.organizationId.trim();
    if (!orgId) {
      throw new BadRequestException('organizationId cannot be empty');
    }

    // Check if security mode is enabled
    if (!this.openSearchTenantService.isSecurityEnabled()) {
      return {
        success: true,
        securityEnabled: false,
        message: 'Security mode disabled, tenant provisioning skipped',
      };
    }

    // Provision tenant resources
    const success = await this.openSearchTenantService.ensureTenantExists(orgId);

    return {
      success,
      securityEnabled: true,
      message: success
        ? `Tenant provisioned for ${orgId}`
        : `Failed to provision tenant for ${orgId}`,
    };
  }
}
