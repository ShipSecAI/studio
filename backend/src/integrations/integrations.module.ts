import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AwsService } from './aws.service';
import { ForgeDiscoveryService } from './forge-discovery.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { SetupTokenService } from './setup-token.service';
import { SlackService } from './slack.service';
import { TokenEncryptionService } from './token.encryption';
import { IntegrationActionRegistry } from './listeners/integration-action.registry';
import { IntegrationConnectedListener } from './listeners/integration-connected.listener';
import { AwsAssetSyncAction } from './listeners/actions/aws-asset-sync.action';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationsRepository,
    TokenEncryptionService,
    AwsService,
    SlackService,
    SetupTokenService,
    ForgeDiscoveryService,
    IntegrationActionRegistry,
    IntegrationConnectedListener,
    AwsAssetSyncAction,
  ],
  exports: [IntegrationsService, SlackService],
})
export class IntegrationsModule {}
