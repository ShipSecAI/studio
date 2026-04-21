import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiHeader } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import {
  AnalyticsQueryRequestDto,
  AnalyticsQueryResponseDto,
  ScannerSeverityCountsRequestDto,
  ScannerSeverityCountsResponseDto,
  ProwlerChecksMetadataResponseDto,
  ProwlerChecksMetadataResponseSchema,
  StorageUsageResponseDto,
  PurgeDataResponseDto,
  TimeSeriesRequestDto,
  TimeSeriesResponseDto,
  LifecycleRequestDto,
  LifecycleResponseDto,
  type ProwlerChecksMetadataResponse,
} from './dto/analytics-query.dto';
import {
  AnalyticsSettingsResponseDto,
  UpdateAnalyticsSettingsDto,
} from './dto/analytics-settings.dto';
import {
  BatchRunSummariesRequestDto,
  BatchRunSummariesResponseDto,
} from './dto/analytics-internal.dto';
import { AuditLogService } from '../audit/audit-log.service';
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
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('query')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
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
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

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

    this.auditLogService.record(auth, {
      action: 'analytics.query',
      resourceType: 'analytics',
      resourceId: null,
      resourceName: null,
      metadata: {
        size,
        from,
        hasFilters: Boolean(queryDto.filters?.length),
        hasAggs: Boolean(queryDto.aggs?.length),
      },
    });

    return this.securityAnalyticsService.query(auth.organizationId, {
      filters: queryDto.filters,
      search: queryDto.search,
      sort: queryDto.sort,
      aggs: queryDto.aggs,
      distinct: queryDto.distinct,
      countDistinct: queryDto.countDistinct,
      size,
      from,
      useLatest: queryDto.useLatest,
    });
  }

  @Post('scanner-severity-counts')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOkResponse({
    description: 'Get severity counts grouped by scanner for security findings',
    type: ScannerSeverityCountsResponseDto,
  })
  async scannerSeverityCounts(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: ScannerSeverityCountsRequestDto,
  ): Promise<ScannerSeverityCountsResponseDto> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    return this.securityAnalyticsService.scannerSeverityCounts(auth.organizationId, {
      filters: body.filters,
      useLatest: body.useLatest,
    });
  }

  @Post('time-series')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOkResponse({
    description: 'Get time-series data for security findings',
    type: TimeSeriesResponseDto,
  })
  async timeSeries(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: TimeSeriesRequestDto,
  ): Promise<TimeSeriesResponseDto> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    return this.securityAnalyticsService.timeSeries(auth.organizationId, {
      filters: body.filters,
      interval: body.interval,
      days: body.days,
      timezone: body.timezone,
    });
  }

  @Post('lifecycle')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOkResponse({
    description: 'Get lifecycle data (first seen, last seen, occurrences) for findings',
    type: LifecycleResponseDto,
  })
  async lifecycle(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: LifecycleRequestDto,
  ): Promise<LifecycleResponseDto> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    const hashes: string[] = [];
    if (body.hash) hashes.push(body.hash);
    if (body.hashes) hashes.push(...body.hashes);

    if (hashes.length === 0) {
      throw new BadRequestException('At least one hash or hashes[] is required');
    }

    const lifecycles = await this.securityAnalyticsService.lifecycle(auth.organizationId, [
      ...new Set(hashes),
    ]);

    return { lifecycles };
  }

  @Get('settings')
  @ApiOkResponse({
    description: 'Get analytics settings for the authenticated organization',
    type: AnalyticsSettingsResponseDto,
  })
  async getAnalyticsSettings(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<AnalyticsSettingsResponseDto> {
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }

    const settings = await this.organizationSettingsService.getOrganizationSettings(
      auth.organizationId,
    );
    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays();

    return {
      organizationId: settings.organizationId,
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
    if (!auth || !auth.isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!auth.organizationId) {
      throw new UnauthorizedException('Organization context required');
    }
    if (!auth.roles.includes('ADMIN')) {
      throw new ForbiddenException('Only organization admins can update analytics settings');
    }

    if (updateDto.analyticsRetentionDays !== undefined) {
      if (
        typeof updateDto.analyticsRetentionDays !== 'number' ||
        !Number.isInteger(updateDto.analyticsRetentionDays)
      ) {
        throw new BadRequestException('Retention period must be an integer number of days');
      }

      const isValid = this.organizationSettingsService.validateRetentionPeriod(
        updateDto.analyticsRetentionDays,
      );

      if (!isValid) {
        throw new BadRequestException(
          `Retention period of ${updateDto.analyticsRetentionDays} days exceeds the public maximum (${this.organizationSettingsService.getMaxRetentionDays()} days)`,
        );
      }
    }

    const updated = await this.organizationSettingsService.updateOrganizationSettings(
      auth.organizationId,
      {
        analyticsRetentionDays: updateDto.analyticsRetentionDays,
      },
    );

    const maxRetentionDays = this.organizationSettingsService.getMaxRetentionDays();

    return {
      organizationId: updated.organizationId,
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
    description: 'Get analytics storage usage for the authenticated organization',
    type: StorageUsageResponseDto,
  })
  async getStorageUsage(@CurrentAuth() auth: AuthContext | null): Promise<StorageUsageResponseDto> {
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
  async purgeData(@CurrentAuth() auth: AuthContext | null): Promise<{ tablesCleared: number }> {
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
}
