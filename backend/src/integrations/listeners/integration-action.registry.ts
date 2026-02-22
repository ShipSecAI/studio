import { Injectable, Logger } from '@nestjs/common';

import type { IntegrationConnectedEvent } from '../events/integration.events';

export interface IntegrationAutoAction {
  name: string;
  providers: string[];
  execute(event: IntegrationConnectedEvent): Promise<void>;
}

@Injectable()
export class IntegrationActionRegistry {
  private readonly logger = new Logger(IntegrationActionRegistry.name);
  private readonly actions: IntegrationAutoAction[] = [];

  register(action: IntegrationAutoAction): void {
    this.actions.push(action);
    this.logger.log(
      `Registered auto-action "${action.name}" for providers: [${action.providers.join(', ')}]`,
    );
  }

  getActionsForProvider(provider: string): IntegrationAutoAction[] {
    return this.actions.filter(
      (action) => action.providers.includes(provider) || action.providers.includes('*'),
    );
  }
}
