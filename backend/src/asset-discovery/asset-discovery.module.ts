import { Module } from '@nestjs/common';
import { AssetDiscoveryController } from './asset-discovery.controller';
import { AssetDiscoveryService } from './asset-discovery.service';
import { AssetDiscoveryRepository } from './asset-discovery.repository';
import { AssetSyncService } from './asset-sync.service';
import { AssetSyncRunsRepository } from './asset-sync-runs.repository';
import { DatabaseModule } from '../database/database.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { TemporalModule } from '../temporal/temporal.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CloudGraphService } from './cloud-graph.service';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [
    DatabaseModule,
    ApiKeysModule,
    AuthModule,
    TemporalModule,
    IntegrationsModule,
    SchedulesModule,
  ],
  controllers: [AssetDiscoveryController],
  providers: [
    AssetDiscoveryService,
    AssetDiscoveryRepository,
    AssetSyncService,
    AssetSyncRunsRepository,
    CloudGraphService,
  ],
  exports: [AssetDiscoveryService, AssetSyncService],
})
export class AssetDiscoveryModule {}
