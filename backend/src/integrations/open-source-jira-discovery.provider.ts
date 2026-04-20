import { Injectable } from '@nestjs/common';
import type { DiscoveredJiraSite, JiraDiscoveryProvider } from '@shipsec/shared';

@Injectable()
export class OpenSourceJiraDiscoveryProvider implements JiraDiscoveryProvider {
  isConfigured(): boolean {
    return false;
  }

  async discoverForSite(_siteHostname: string): Promise<DiscoveredJiraSite | null> {
    return null;
  }
}
