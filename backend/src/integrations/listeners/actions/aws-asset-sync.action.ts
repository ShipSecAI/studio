import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AuthContext } from '../../../auth/types';

import type { IntegrationConnectedEvent } from '../../events/integration.events';
import type { IntegrationAutoAction } from '../integration-action.registry';
import { IntegrationActionRegistry } from '../integration-action.registry';
import { IndexInfraService } from '../../../schedules/index-infra.service';

@Injectable()
export class AwsAssetSyncAction implements IntegrationAutoAction, OnModuleInit {
  readonly name = 'cloud-asset-sync';
  readonly providers = ['aws', 'gcp'];

  private readonly logger = new Logger(AwsAssetSyncAction.name);

  constructor(
    private readonly indexInfraService: IndexInfraService,
    private readonly actionRegistry: IntegrationActionRegistry,
  ) {}

  onModuleInit(): void {
    this.actionRegistry.register(this);
  }

  async execute(event: IntegrationConnectedEvent): Promise<void> {
    const providerLabel = formatProviderLabel(event.provider);
    this.logger.log(
      `Triggering Index Infra workflow for ${providerLabel} connection ${event.connectionId} (org=${event.organizationId})`,
    );

    const auth: AuthContext = {
      userId: event.userId,
      organizationId: event.organizationId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'system',
    };

    await this.indexInfraService.ensureDefaultScheduleForIntegration(auth, event.connectionId);
    await this.indexInfraService.triggerRun({
      auth,
      integrationId: event.connectionId,
      trigger: {
        type: 'api',
        sourceId: event.connectionId,
        label: event.isReconnect
          ? `${providerLabel} integration reconnected`
          : `${providerLabel} integration connected`,
      },
    });
  }
}

function formatProviderLabel(provider: string): string {
  switch (provider) {
    case 'aws':
      return 'AWS';
    case 'gcp':
      return 'GCP';
    default:
      return provider.toUpperCase();
  }
}
