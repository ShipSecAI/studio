import type {
  AiGatewayProvider,
  AiGatewayResolutionInput,
  AiGatewayResolution,
  BillingProvider,
  BillingUsageRequest,
  BillingUsageSummary,
  DiscoveredJiraSite,
  JiraDiscoveryProvider,
  ProviderOverrides,
  ProviderRegistry,
  SubscriptionPlanSnapshot,
} from '@shipsec/shared';
import { loadProviderOverrides } from './provider-overrides.loader';

class OssBillingProvider implements BillingProvider {
  isConfigured(): boolean {
    return false;
  }

  async getUsageSummary(_request: BillingUsageRequest): Promise<BillingUsageSummary> {
    throw new Error('Billing is not available in this deployment.');
  }

  async listPlans(): Promise<SubscriptionPlanSnapshot[]> {
    return [];
  }
}

class OssAiGatewayProvider implements AiGatewayProvider {
  shouldRouteViaGateway(): boolean {
    return (process.env.CHAT_AI_BASE_URL?.trim() ?? '').length > 0;
  }

  getGatewayBaseUrl(): string {
    return process.env.CHAT_AI_BASE_URL?.trim() || '';
  }

  getGatewayApiKey(): string {
    return process.env.CHAT_AI_API_KEY?.trim() || '';
  }

  normalizeModel(provider: string, model: string): string {
    if (model.includes('/')) return model;
    if (provider === 'gemini') return `gemini/${model}`;
    if (provider === 'openrouter') return `openrouter/${model}`;
    if (provider === 'zai-coding-plan') return `openai/${model}`;
    return model;
  }

  async fetchOrganizationApiKey(_orgId: string): Promise<string | null> {
    return this.getGatewayApiKey() || null;
  }

  async resolve(input: AiGatewayResolutionInput): Promise<AiGatewayResolution> {
    return {
      routeViaGateway: this.shouldRouteViaGateway(),
      baseUrl: input.backendUrl?.trim() ? this.getGatewayBaseUrl() : this.getGatewayBaseUrl(),
      apiKey: this.getGatewayApiKey(),
      modelId:
        input.provider && input.modelId
          ? this.normalizeModel(input.provider, input.modelId)
          : (input.modelId ?? null),
      organizationApiKey: null,
    };
  }
}

class ManualJiraDiscoveryProvider implements JiraDiscoveryProvider {
  isConfigured(): boolean {
    return false;
  }

  async discoverForSite(_siteHostname: string): Promise<DiscoveredJiraSite | null> {
    return null;
  }
}

let cachedOverrides: ProviderOverrides | null = null;

export function getProviderOverrides(): ProviderOverrides {
  if (cachedOverrides) return cachedOverrides;
  cachedOverrides = loadProviderOverrides();
  return cachedOverrides;
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return {
    billing: new OssBillingProvider(),
    aiGateway: new OssAiGatewayProvider(),
    jiraDiscovery: new ManualJiraDiscoveryProvider(),
  };
}

export function resolveProvider<K extends keyof ProviderRegistry>(
  key: K,
  fallback: ProviderRegistry[K],
): ProviderRegistry[K] {
  const overrides = getProviderOverrides();
  return (overrides[key] as ProviderRegistry[K] | undefined) ?? fallback;
}

export function resetProviderOverridesForTests(): void {
  cachedOverrides = null;
}
