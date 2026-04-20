import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AwsService } from './aws.service';
import { GcpService } from './gcp.service';
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
import { SchedulesModule } from '../schedules/schedules.module';
import { JIRA_DISCOVERY_PROVIDER } from '../providers/tokens';
import { resolveProvider } from '../providers/provider-registry';
import { OpenSourceJiraDiscoveryProvider } from './open-source-jira-discovery.provider';

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
    ForgeDiscoveryService,
    OpenSourceJiraDiscoveryProvider,
    {
      provide: JIRA_DISCOVERY_PROVIDER,
      useFactory: (fallback: OpenSourceJiraDiscoveryProvider) =>
        resolveProvider('jiraDiscovery', fallback),
      inject: [OpenSourceJiraDiscoveryProvider],
    },
    IntegrationActionRegistry,
    IntegrationConnectedListener,
    AwsAssetSyncAction,
  ],
  exports: [IntegrationsService, SlackService],
})
export class IntegrationsModule {}
