/**
 * Feature flag types and registry configuration.
 *
 * Each FeatureKey maps to a feature section in the app.
 * Features can declare dependencies — disabling a parent cascades to children.
 */

export type FeatureKey =
  // Core platform
  | 'WORKFLOWS'
  | 'WORKFLOW_TEMPLATES'
  | 'WORKFLOW_SCHEDULES'
  | 'WEBHOOKS'
  // AI
  | 'AI_AGENT'
  | 'AI_FINDINGS'
  // Code Security (GitHub)
  | 'GITHUB_INTEGRATION'
  | 'CODE_SCANS'
  | 'PR_PROTECTION'
  // Cloud Security
  | 'CLOUD_SECURITY'
  | 'CLOUD_INVENTORY'
  | 'CLOUD_SCANS'
  // Attack Surface Management
  | 'ASM'
  | 'ASM_DOMAINS'
  | 'ASM_ASSETS'
  | 'ASM_SCANS'
  // Security Dashboard
  | 'SECURITY_DASHBOARD'
  // Settings & Management
  | 'INTEGRATIONS'
  | 'SECRETS'
  | 'API_KEYS'
  | 'MCP_SERVERS'
  | 'ARTIFACTS'
  | 'ACTION_CENTER'
  | 'ANALYTICS_SETTINGS';

export interface FeatureDefinition {
  key: FeatureKey;
  /** Human-readable label for admin UI / docs */
  label: string;
  /** Feature keys this feature depends on. If any parent is off, this is off. */
  dependsOn?: FeatureKey[];
  /** Default enabled state when no remote flag is set */
  defaultEnabled: boolean;
  /** PostHog feature flag key (snake_case, prefixed with ff_) */
  posthogKey: string;
  /** Optional Vite build-time env var. If set to 'false', this feature is forced off. */
  buildTimeEnv?: string;
}

export type FeatureRegistry = Record<FeatureKey, FeatureDefinition>;

export type ResolvedFlags = Record<FeatureKey, boolean>;
