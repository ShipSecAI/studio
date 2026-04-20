import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JiraDiscoveryProvider } from '@shipsec/shared';
import { JIRA_DISCOVERY_PROVIDER } from '../providers/tokens';

@Injectable()
export class ForgeDiscoveryService {
  private readonly logger = new Logger(ForgeDiscoveryService.name);

  constructor(
    @Inject(JIRA_DISCOVERY_PROVIDER)
    private readonly jiraDiscoveryProvider: JiraDiscoveryProvider,
  ) {}

  async discoverForSite(siteHostname: string) {
    if (this.jiraDiscoveryProvider.isConfigured()) {
      return this.jiraDiscoveryProvider.discoverForSite(siteHostname);
    }

    this.logger.debug(
      `Forge discovery is not available in the public studio build; use manual Jira setup for ${siteHostname}`,
    );
    return null;
  }

  isConfigured(): boolean {
    return this.jiraDiscoveryProvider.isConfigured();
  }
}
