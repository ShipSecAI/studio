import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { TemporalService } from '../../../temporal/temporal.service';
import type { IntegrationConnectedEvent } from '../../events/integration.events';
import type { IntegrationAutoAction } from '../integration-action.registry';
import { IntegrationActionRegistry } from '../integration-action.registry';

@Injectable()
export class AwsAssetSyncAction implements IntegrationAutoAction, OnModuleInit {
  readonly name = 'aws-asset-sync';
  readonly providers = ['aws'];

  private readonly logger = new Logger(AwsAssetSyncAction.name);

  constructor(
    private readonly temporalService: TemporalService,
    private readonly actionRegistry: IntegrationActionRegistry,
  ) {}

  onModuleInit(): void {
    this.actionRegistry.register(this);
  }

  async execute(event: IntegrationConnectedEvent): Promise<void> {
    this.logger.log(
      `Triggering asset sync for AWS connection ${event.connectionId} (org=${event.organizationId})`,
    );

    try {
      await this.temporalService.startWorkflow({
        workflowType: 'assetSyncWorkflow',
        workflowId: `asset-sync-${event.connectionId}`,
        args: [
          {
            integrationId: event.connectionId,
            organizationId: event.organizationId,
          },
        ],
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log(`Asset sync workflow already running for ${event.connectionId}, skipping`);
        return;
      }

      // Fallback: match by error message in case the specific error type isn't available
      if (error instanceof Error && error.message.includes('already started')) {
        this.logger.log(
          `Asset sync workflow already running for ${event.connectionId}, skipping (message match)`,
        );
        return;
      }

      throw error;
    }
  }
}
