import { Module } from '@nestjs/common';

import { WorkflowsModule } from '../workflows/workflows.module';
import { StorageModule } from '../storage/storage.module';
import { NodeIOModule } from '../node-io/node-io.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { SecretsModule } from '../secrets/secrets.module';
import { HumanInputsModule } from '../human-inputs/human-inputs.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AssetDiscoveryModule } from '../asset-discovery/asset-discovery.module';
import { AsmModule } from '../asm/asm.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StudioMcpController } from './studio-mcp.controller';
import { StudioMcpService } from './studio-mcp.service';

@Module({
  imports: [
    WorkflowsModule,
    StorageModule,
    NodeIOModule,
    SchedulesModule,
    SecretsModule,
    HumanInputsModule,
    AnalyticsModule,
    AssetDiscoveryModule,
    AsmModule,
    IntegrationsModule,
    // TraceModule is @Global() — no import needed
  ],
  controllers: [StudioMcpController],
  providers: [StudioMcpService],
  exports: [StudioMcpService],
})
export class StudioMcpModule {}
