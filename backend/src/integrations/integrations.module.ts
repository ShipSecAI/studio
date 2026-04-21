import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AwsService } from './aws.service';
import { GcpService } from './gcp.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { SetupTokenService } from './setup-token.service';
import { SlackService } from './slack.service';
import { TokenEncryptionService } from './token.encryption';
import { IntegrationActionRegistry } from './listeners/integration-action.registry';
import { IntegrationConnectedListener } from './listeners/integration-connected.listener';
import { AwsAssetSyncAction } from './listeners/actions/aws-asset-sync.action';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [DatabaseModule, SchedulesModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationsRepository,
    TokenEncryptionService,
    AwsService,
    GcpService,
    SlackService,
    SetupTokenService,
    IntegrationActionRegistry,
    IntegrationConnectedListener,
    AwsAssetSyncAction,
  ],
  exports: [IntegrationsService, SlackService],
})
export class IntegrationsModule {}
