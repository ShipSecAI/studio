import { Injectable, Logger } from '@nestjs/common';
import type { DiscoveredJiraSite, JiraDiscoveryProvider } from '@shipsec/shared';

@Injectable()
export class OpenSourceJiraDiscoveryProvider implements JiraDiscoveryProvider {
  private readonly logger = new Logger(OpenSourceJiraDiscoveryProvider.name);

  isConfigured(): boolean {
    return false;
  }

  async discoverForSite(siteHostname: string): Promise<DiscoveredJiraSite | null> {
    this.logger.debug(
      `Forge discovery is not available in the public studio build; use manual Jira setup for ${siteHostname}`,
    );
    return null;
  }
}
