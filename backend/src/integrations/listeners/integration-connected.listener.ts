import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { IntegrationConnectedEvent } from '../events/integration.events';
import { IntegrationActionRegistry } from './integration-action.registry';

@Injectable()
export class IntegrationConnectedListener {
  private readonly logger = new Logger(IntegrationConnectedListener.name);

  constructor(private readonly actionRegistry: IntegrationActionRegistry) {}

  @OnEvent(IntegrationConnectedEvent.EVENT_NAME, { async: true, promisify: true })
  async handleIntegrationConnected(event: IntegrationConnectedEvent): Promise<void> {
    try {
      const actions = this.actionRegistry.getActionsForProvider(event.provider);

      if (actions.length === 0) {
        this.logger.debug(`No auto-actions registered for provider "${event.provider}"`);
        return;
      }

      this.logger.log(
        `Running ${actions.length} auto-action(s) for ${event.provider} connection ${event.connectionId}`,
      );

      for (const action of actions) {
        try {
          await action.execute(event);
          this.logger.log(`Auto-action "${action.name}" completed for ${event.connectionId}`);
        } catch (error) {
          this.logger.error(
            `Auto-action "${action.name}" failed for ${event.connectionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Integration connected listener failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
