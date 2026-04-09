import { Injectable, Logger } from '@nestjs/common';

interface ForgeInstallation {
  id: string;
  installationContext: string;
  environment: { key: string; type: string };
}

interface ForgeWebTrigger {
  id: string;
  triggerKey: string;
  url: string;
}

interface DiscoveredJiraSite {
  installationId: string;
  siteId: string;
  hostname: string;
  environment: string;
  webTriggerUrl: string | null;
}

@Injectable()
export class ForgeDiscoveryService {
  private readonly logger = new Logger(ForgeDiscoveryService.name);

  private readonly appId = process.env.FORGE_APP_ID || 'a03d42c4-96f6-4f75-8dff-8fbc7c419e47';
  private readonly appAri = `ari:cloud:ecosystem::app/${this.appId}`;
  private readonly graphqlUrl = 'https://api.atlassian.com/graphql';

  private getAuthHeader(): string | null {
    const email = process.env.FORGE_EMAIL;
    const token = process.env.FORGE_API_TOKEN;
    if (!email || !token) return null;
    return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  private async graphql<T>(
    operationName: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const auth = this.getAuthHeader();
    if (!auth) {
      throw new Error('FORGE_EMAIL and FORGE_API_TOKEN environment variables are required');
    }

    const res = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables, operationName }),
    });

    if (!res.ok) {
      throw new Error(`Atlassian GraphQL API returned ${res.status}`);
    }

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      this.logger.warn(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    if (!json.data) {
      throw new Error('No data returned from Atlassian GraphQL API');
    }
    return json.data;
  }

  async listInstallations(): Promise<ForgeInstallation[]> {
    const data = await this.graphql<{
      ecosystem: {
        appInstallationsByApp: {
          nodes: {
            id: string;
            installationContext: string;
            appEnvironment: { key: string; type: string };
          }[];
        };
      };
    }>(
      'listInstallations',
      `query listInstallations($filter: AppInstallationsByAppFilter!) {
        ecosystem {
          appInstallationsByApp(filter: $filter) {
            nodes {
              id
              installationContext
              appEnvironment { key type }
            }
          }
        }
      }`,
      { filter: { apps: { ids: [this.appAri] } } },
    );

    return data.ecosystem.appInstallationsByApp.nodes.map((n) => ({
      id: n.id,
      installationContext: n.installationContext,
      environment: { key: n.appEnvironment.key, type: n.appEnvironment.type },
    }));
  }

  async getEnvironmentId(environmentKey: string): Promise<string> {
    const data = await this.graphql<{
      app: { environmentByKey: { id: string; type: string } | null };
    }>(
      'getEnvironmentId',
      `query getEnvironmentId($appId: ID!, $envKey: String!) {
        app(id: $appId) {
          environmentByKey(key: $envKey) { id type }
        }
      }`,
      { appId: this.appAri, envKey: environmentKey },
    );

    if (!data.app?.environmentByKey) {
      throw new Error(`Environment '${environmentKey}' not found for app`);
    }
    return data.app.environmentByKey.id;
  }

  async getWebTriggerUrls(contextId: string, envId: string): Promise<ForgeWebTrigger[]> {
    const data = await this.graphql<{
      webTriggerUrlsByAppContext: ForgeWebTrigger[];
    }>(
      'listWebTriggerUrls',
      `query listWebTriggerUrls($appId: ID!, $contextId: ID!, $envId: ID!) {
        webTriggerUrlsByAppContext(appId: $appId, contextId: $contextId, envId: $envId) {
          id
          triggerKey
          url
        }
      }`,
      { appId: this.appId, contextId, envId },
    );

    return data.webTriggerUrlsByAppContext ?? [];
  }

  async createWebTriggerUrl(contextId: string, envId: string, triggerKey: string): Promise<string> {
    const data = await this.graphql<{
      createWebTriggerUrl: { success: boolean; url: string | null; message: string };
    }>(
      'createWebTriggerUrl',
      `mutation createWebTriggerUrl($input: WebTriggerUrlInput!) {
        createWebTriggerUrl(input: $input) {
          success
          url
          message
        }
      }`,
      {
        input: {
          appId: this.appId,
          contextId,
          envId,
          triggerKey,
        },
      },
    );

    if (!data.createWebTriggerUrl.success || !data.createWebTriggerUrl.url) {
      throw new Error(`Failed to create web trigger URL: ${data.createWebTriggerUrl.message}`);
    }
    return data.createWebTriggerUrl.url;
  }

  async resolveSiteHostname(contextAri: string): Promise<string | null> {
    // Context ARI format: ari:cloud:jira::site/{cloudId}
    const match = contextAri.match(/site\/([a-f0-9-]+)/);
    if (!match) return null;
    const cloudId = match[1];

    try {
      const data = await this.graphql<{
        tenantContexts: { cloudUrl: string }[];
      }>(
        'resolveSite',
        `query resolveSite($cloudIds: [ID!]!) {
          tenantContexts(cloudIds: $cloudIds) {
            cloudUrl
          }
        }`,
        { cloudIds: [cloudId] },
      );

      const url = data.tenantContexts?.[0]?.cloudUrl;
      if (!url) return null;
      // cloudUrl is like "https://shipsec.atlassian.net" → extract hostname
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    } catch {
      return null;
    }
  }

  /**
   * Main discovery method: find installation for a given Jira site hostname
   * and return the web trigger URL.
   */
  async discoverForSite(siteHostname: string): Promise<DiscoveredJiraSite | null> {
    const installations = await this.listInstallations();
    if (installations.length === 0) {
      this.logger.warn('No Forge app installations found');
      return null;
    }

    // Resolve hostnames for all installations to find the matching one
    for (const inst of installations) {
      const hostname = await this.resolveSiteHostname(inst.installationContext);
      if (!hostname) continue;

      // Match by hostname (with or without .atlassian.net suffix)
      const normalizedInput = siteHostname.replace(/\.atlassian\.net$/, '');
      const normalizedHost = hostname.replace(/\.atlassian\.net$/, '');
      if (normalizedInput !== normalizedHost) continue;

      // Found the matching installation — get environment ID and web trigger URL
      const envId = await this.getEnvironmentId(inst.environment.key);

      // Try to get existing web trigger URLs first
      let webTriggerUrl: string | null = null;
      const existing = await this.getWebTriggerUrls(inst.installationContext, envId);
      const mcpTrigger = existing.find((t) => t.triggerKey === 'mcp-endpoint');

      if (mcpTrigger) {
        webTriggerUrl = mcpTrigger.url;
      } else {
        // Create one
        try {
          webTriggerUrl = await this.createWebTriggerUrl(
            inst.installationContext,
            envId,
            'mcp-endpoint',
          );
        } catch (err) {
          this.logger.error(`Failed to create web trigger URL: ${err}`);
        }
      }

      const siteId = inst.installationContext.match(/site\/([a-f0-9-]+)/)?.[1] ?? '';

      return {
        installationId: inst.id,
        siteId,
        hostname,
        environment: inst.environment.type,
        webTriggerUrl,
      };
    }

    return null;
  }

  isConfigured(): boolean {
    return Boolean(process.env.FORGE_EMAIL && process.env.FORGE_API_TOKEN);
  }
}
