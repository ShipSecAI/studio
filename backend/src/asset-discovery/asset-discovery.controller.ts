import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AssetDiscoveryService } from './asset-discovery.service';
import { AssetSyncService } from './asset-sync.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { InternalOnly } from '../common/guards/internal-only.guard';
import type { AuthContext } from '../auth/types';
import { ListAssetsDto } from './dto/list-assets.dto';
import { ListSyncRunsDto } from './dto/list-sync-runs.dto';
import {
  CreateSyncRunRequestDto,
  CreateSyncRunResponseDto,
  MarkStaleAssetsRequestDto,
  MarkStaleAssetsResponseDto,
  PersistSyncRunScopesRequestDto,
  PersistSyncRunScopesResponseDto,
  ReconcileAssetsRequestDto,
  ReconcileAssetsResponseDto,
  TriggerSyncDto,
  UpdateSyncRunStatusRequestDto,
  UpdateSyncRunStatusResponseDto,
} from './dto/sync-assets.dto';

const cloudAssetSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string' },
    integrationId: { type: 'string', format: 'uuid', nullable: true },
    provider: { type: 'string' },
    accountIdentifier: { type: 'string', nullable: true },
    assetType: { type: 'string' },
    externalId: { type: 'string' },
    name: { type: 'string', nullable: true },
    region: { type: 'string', nullable: true },
    status: { type: 'string' },
    metadata: { type: 'object', additionalProperties: true, nullable: true },
    firstDiscoveredAt: { type: 'string', format: 'date-time' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'organizationId',
    'provider',
    'assetType',
    'externalId',
    'status',
    'firstDiscoveredAt',
    'lastSeenAt',
    'createdAt',
    'updatedAt',
  ],
};

const cloudAssetSummarySchema = {
  type: 'object',
  properties: {
    totalAssets: { type: 'number' },
    byType: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assetType: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['assetType', 'count'],
      },
    },
    byRegion: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['region', 'count'],
      },
    },
    byStatus: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['status', 'count'],
      },
    },
  },
  required: ['totalAssets', 'byType', 'byRegion', 'byStatus'],
};

const cloudSyncRunSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string' },
    integrationId: { type: 'string', format: 'uuid' },
    accountIdentifier: { type: 'string', nullable: true },
    temporalWorkflowId: { type: 'string', nullable: true },
    temporalRunId: { type: 'string', nullable: true },
    status: { type: 'string' },
    coveredRegions: { type: 'array', items: { type: 'string' }, nullable: true },
    assetsDiscovered: { type: 'number', nullable: true },
    assetsCreated: { type: 'number', nullable: true },
    assetsUpdated: { type: 'number', nullable: true },
    assetsStale: { type: 'number', nullable: true },
    errors: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['message', 'timestamp'],
      },
    },
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'organizationId', 'integrationId', 'status', 'startedAt', 'createdAt'],
};

@ApiTags('asset-discovery')
@Controller('asset-discovery')
export class AssetDiscoveryController {
  constructor(
    private readonly service: AssetDiscoveryService,
    private readonly syncService: AssetSyncService,
  ) {}

  // ── Public endpoints (AuthGuard applied globally) ──────────────────────────

  @Get('assets')
  @ApiQuery({ name: 'provider', required: false, type: String })
  @ApiQuery({ name: 'assetType', required: false, type: String })
  @ApiQuery({ name: 'region', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'stale', 'removed'] })
  @ApiQuery({ name: 'integrationId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'lastSeenAt', 'firstDiscoveredAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({
    description: 'Cloud assets with pagination metadata',
    schema: {
      type: 'object',
      properties: {
        assets: { type: 'array', items: cloudAssetSchema },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['assets', 'total', 'page', 'limit'],
    },
  })
  async listAssets(@CurrentAuth() auth: AuthContext, @Query() query: ListAssetsDto) {
    return this.service.listAssets(auth, query);
  }

  @Get('assets/summary')
  @ApiOkResponse({
    description: 'Cloud asset summary aggregates',
    schema: cloudAssetSummarySchema,
  })
  async getAssetSummary(@CurrentAuth() auth: AuthContext) {
    return this.service.getSummary(auth);
  }

  @Get('assets/:id')
  @ApiOkResponse({
    description: 'Single cloud asset',
    schema: cloudAssetSchema,
  })
  async getAsset(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.getAsset(auth, id);
  }

  @Post('assets/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'Cloud sync accepted',
    schema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
      },
      required: ['workflowId'],
    },
  })
  async triggerSync(@CurrentAuth() auth: AuthContext, @Body() body: TriggerSyncDto) {
    return this.syncService.triggerSync(body.integrationId, auth);
  }

  @Get('sync-runs')
  @ApiQuery({ name: 'integrationId', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description: 'Cloud sync runs with pagination metadata',
    schema: {
      type: 'object',
      properties: {
        syncRuns: { type: 'array', items: cloudSyncRunSchema },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['syncRuns', 'total', 'page', 'limit'],
    },
  })
  async listSyncRuns(@CurrentAuth() auth: AuthContext, @Query() query: ListSyncRunsDto) {
    return this.service.listSyncRuns(auth, query);
  }

  @Get('sync-runs/:id')
  @ApiOkResponse({
    description: 'Single cloud sync run',
    schema: cloudSyncRunSchema,
  })
  async getSyncRun(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.getSyncRun(auth, id);
  }

  // ── Internal endpoints (called by worker activities) ───────────────────────

  @Post('internal/sync-runs')
  @InternalOnly()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CreateSyncRunResponseDto })
  async createSyncRun(
    @Headers('x-organization-id') orgId: string,
    @Body() body: CreateSyncRunRequestDto,
  ) {
    return this.service.createSyncRun(
      orgId,
      body.integrationId,
      body.accountIdentifier,
      body.regions,
      body.temporalWorkflowId,
      body.temporalRunId,
    );
  }

  @Post('internal/assets/reconcile')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ReconcileAssetsResponseDto })
  async reconcileAssets(
    @Headers('x-organization-id') orgId: string,
    @Body() body: ReconcileAssetsRequestDto,
  ) {
    return this.service.reconcileAssets(
      orgId,
      body.integrationId,
      body.accountIdentifier,
      body.syncRunId,
      body.assets,
    );
  }

  @Post('internal/sync-runs/:id/scopes')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PersistSyncRunScopesResponseDto })
  async persistSyncRunScopes(
    @Param('id') syncRunId: string,
    @Body() body: PersistSyncRunScopesRequestDto,
  ) {
    await this.service.persistSyncRunScopes(syncRunId, body.scopes);
    return { success: true as const };
  }

  @Post('internal/assets/mark-stale')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MarkStaleAssetsResponseDto })
  async markStaleAssets(
    @Headers('x-organization-id') orgId: string,
    @Body() body: MarkStaleAssetsRequestDto,
  ) {
    return this.service.markStaleAssets(
      orgId,
      body.integrationId,
      body.accountIdentifier,
      body.syncRunId,
      new Date(body.syncStartTime),
    );
  }

  @Post('internal/sync-runs/:id/status')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateSyncRunStatusResponseDto })
  async updateSyncRunStatus(
    @Param('id') syncRunId: string,
    @Body() body: UpdateSyncRunStatusRequestDto,
  ) {
    return this.service.updateSyncRunStatus(syncRunId, body.status, body);
  }
}
