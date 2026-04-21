export type SubscriptionTier = 'free' | 'pro' | 'team' | 'enterprise';

export interface SubscriptionPlanSummary {
  id: string;
  displayName: string;
  priceUsdCents: number;
}

export interface SubscriptionPlanSnapshot {
  id: string;
  displayName: string;
  priceUsdCents: number;
  workflowRunsPerMonth: number;
  aiBudgetUsdCents: number;
  maxConcurrentRuns: number;
  analyticsRetentionDays: number;
  maxWorkflows: number;
}

export interface BillingUsageRequest {
  organizationId: string;
  now?: Date;
}

export interface BillingUsageSummary {
  organizationId: string;
  subscriptionTier: SubscriptionTier;
  plan: SubscriptionPlanSummary;
  period: {
    start: string;
    end: string;
  };
  workflowRuns: {
    used: number;
    limit: number;
    remaining: number;
  };
  ai: {
    spentUsd: number;
    budgetUsd: number;
    remainingUsd: number;
  };
  limits: {
    maxConcurrentRuns: number;
    maxWorkflows: number;
    analyticsRetentionDays: number;
  };
}

export interface DiscoveredJiraSite {
  installationId: string;
  siteId: string;
  hostname: string;
  environment: string;
  webTriggerUrl: string | null;
}

export interface AiGatewayResolutionInput {
  organizationId?: string | null;
  provider?: string | null;
  modelId?: string | null;
  consumer?: string;
  backendUrl?: string;
}

export interface AiGatewayResolution {
  routeViaGateway: boolean;
  baseUrl: string;
  apiKey: string;
  modelId?: string | null;
  organizationApiKey?: string | null;
}

export interface BillingProvider {
  isConfigured(): boolean;
  getUsageSummary(request: BillingUsageRequest): Promise<BillingUsageSummary>;
  listPlans(): Promise<SubscriptionPlanSnapshot[]>;
  getVirtualKey?(organizationId: string): Promise<string | null>;
}

export interface JiraDiscoveryProvider {
  isConfigured(): boolean;
  discoverForSite(siteHostname: string): Promise<DiscoveredJiraSite | null>;
}

export interface AiGatewayProvider {
  shouldRouteViaGateway(): boolean;
  getGatewayBaseUrl(): string;
  getGatewayApiKey(): string;
  normalizeModel(provider: string, model: string): string;
  fetchOrganizationApiKey(
    orgId: string,
    options?: { backendUrl?: string; consumer?: string },
  ): Promise<string | null>;
  resolve(input: AiGatewayResolutionInput): Promise<AiGatewayResolution>;
}

export interface ProviderRegistry {
  billing: BillingProvider;
  jiraDiscovery: JiraDiscoveryProvider;
  aiGateway: AiGatewayProvider;
}

export type ProviderOverrides = Partial<ProviderRegistry>;
