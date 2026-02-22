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
import { AssetDiscoveryService } from './asset-discovery.service';
import { AssetSyncService } from './asset-sync.service';
import { CurrentAuth } from '../auth/auth-context.decorator';
import { InternalOnly } from '../common/guards/internal-only.guard';
import type { AuthContext } from '../auth/types';
import { ListAssetsDto } from './dto/list-assets.dto';
import { ListSyncRunsDto } from './dto/list-sync-runs.dto';
import { TriggerSyncDto } from './dto/sync-assets.dto';

@Controller('asset-discovery')
export class AssetDiscoveryController {
  constructor(
    private readonly service: AssetDiscoveryService,
    private readonly syncService: AssetSyncService,
  ) {}

  // ── Public endpoints (AuthGuard applied globally) ──────────────────────────

  @Get('assets')
  async listAssets(@CurrentAuth() auth: AuthContext, @Query() query: ListAssetsDto) {
    return this.service.listAssets(auth, query);
  }

  @Get('assets/summary')
  async getAssetSummary(@CurrentAuth() auth: AuthContext) {
    return this.service.getSummary(auth);
  }

  @Get('assets/:id')
  async getAsset(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.getAsset(auth, id);
  }

  @Post('assets/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(@CurrentAuth() auth: AuthContext, @Body() body: TriggerSyncDto) {
    return this.syncService.triggerSync(body.integrationId, auth);
  }

  @Get('sync-runs')
  async listSyncRuns(@CurrentAuth() auth: AuthContext, @Query() query: ListSyncRunsDto) {
    return this.service.listSyncRuns(auth, query);
  }

  @Get('sync-runs/:id')
  async getSyncRun(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.service.getSyncRun(auth, id);
  }

  // ── Internal endpoints (called by worker activities) ───────────────────────

  @Post('internal/sync-runs')
  @InternalOnly()
  @HttpCode(HttpStatus.CREATED)
  async createSyncRun(
    @Headers('x-organization-id') orgId: string,
    @Body()
    body: {
      integrationId: string;
      accountIdentifier: string;
      regions: string[];
      temporalWorkflowId?: string;
      temporalRunId?: string;
    },
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
  async reconcileAssets(
    @Headers('x-organization-id') orgId: string,
    @Body()
    body: {
      integrationId: string;
      accountIdentifier: string;
      syncRunId: string;
      assets: {
        assetType: string;
        externalId: string;
        name: string;
        region?: string;
        metadata: Record<string, unknown>;
      }[];
    },
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
  async persistSyncRunScopes(
    @Param('id') syncRunId: string,
    @Body()
    body: {
      scopes: { assetType: string; region: string }[];
    },
  ) {
    return this.service.persistSyncRunScopes(syncRunId, body.scopes);
  }

  @Post('internal/assets/mark-stale')
  @InternalOnly()
  @HttpCode(HttpStatus.OK)
  async markStaleAssets(
    @Headers('x-organization-id') orgId: string,
    @Body()
    body: {
      integrationId: string;
      accountIdentifier: string;
      syncRunId: string;
      syncStartTime: string;
    },
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
  async updateSyncRunStatus(
    @Param('id') syncRunId: string,
    @Body()
    body: {
      status: string;
      assetsDiscovered?: number;
      assetsCreated?: number;
      assetsUpdated?: number;
      assetsStale?: number;
      coveredRegions?: string[];
      errors?: { message: string; timestamp: string }[];
    },
  ) {
    return this.service.updateSyncRunStatus(syncRunId, body.status, body);
  }
}
