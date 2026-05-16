import type { FeatureRegistry } from './types';

/**
 * Central feature registry.
 *
 * Rules:
 * - Every feature section in the app has an entry here.
 * - `dependsOn` declares parent features — if a parent is disabled, the child is too.
 * - `posthogKey` is the flag name in the PostHog dashboard (create it there to control remotely).
 * - `buildTimeEnv` (optional) maps to a VITE_FF_* env var that can force a feature family off.
 * - `defaultEnabled: true` means the feature is ON unless explicitly disabled.
 */
export const featureRegistry: FeatureRegistry = {
  // ── Core Workflows ──────────────────────────────────────────────
  WORKFLOWS: {
    key: 'WORKFLOWS',
    label: 'Workflow Engine',
    defaultEnabled: true,
    posthogKey: 'ff_workflows',
    buildTimeEnv: 'VITE_FF_WORKFLOWS',
  },
  WORKFLOW_TEMPLATES: {
    key: 'WORKFLOW_TEMPLATES',
    label: 'Workflow Templates',
    dependsOn: ['WORKFLOWS'],
    defaultEnabled: true,
    posthogKey: 'ff_workflow_templates',
  },
  WORKFLOW_SCHEDULES: {
    key: 'WORKFLOW_SCHEDULES',
    label: 'Workflow Schedules',
    dependsOn: ['WORKFLOWS'],
    defaultEnabled: true,
    posthogKey: 'ff_workflow_schedules',
  },
  WEBHOOKS: {
    key: 'WEBHOOKS',
    label: 'Webhooks',
    dependsOn: ['WORKFLOWS'],
    defaultEnabled: true,
    posthogKey: 'ff_webhooks',
  },

  // ── AI ──────────────────────────────────────────────────────────
  AI_AGENT: {
    key: 'AI_AGENT',
    label: 'ShipSec AI Agent',
    defaultEnabled: true,
    posthogKey: 'ff_ai_agent',
    buildTimeEnv: 'VITE_FF_AI_AGENT',
  },
  AI_FINDINGS: {
    key: 'AI_FINDINGS',
    label: 'AI Correlated Findings Dashboard',
    defaultEnabled: true,
    posthogKey: 'ff_ai_findings',
  },

  // ── Code Security (GitHub) ─────────────────────────────────────
  GITHUB_INTEGRATION: {
    key: 'GITHUB_INTEGRATION',
    label: 'GitHub Integration',
    defaultEnabled: true,
    posthogKey: 'ff_github_integration',
    buildTimeEnv: 'VITE_FF_GITHUB',
  },
  CODE_SCANS: {
    key: 'CODE_SCANS',
    label: 'Code Scan Results',
    dependsOn: ['GITHUB_INTEGRATION'],
    defaultEnabled: true,
    posthogKey: 'ff_code_scans',
  },
  PR_PROTECTION: {
    key: 'PR_PROTECTION',
    label: 'PR Protection Rules',
    dependsOn: ['GITHUB_INTEGRATION', 'CODE_SCANS'],
    defaultEnabled: true,
    posthogKey: 'ff_pr_protection',
  },

  // ── Cloud Security ─────────────────────────────────────────────
  CLOUD_SECURITY: {
    key: 'CLOUD_SECURITY',
    label: 'Cloud Security',
    defaultEnabled: true,
    posthogKey: 'ff_cloud_security',
    buildTimeEnv: 'VITE_FF_CLOUD',
  },
  CLOUD_INVENTORY: {
    key: 'CLOUD_INVENTORY',
    label: 'Cloud Inventory',
    dependsOn: ['CLOUD_SECURITY'],
    defaultEnabled: true,
    posthogKey: 'ff_cloud_inventory',
  },
  CLOUD_SCANS: {
    key: 'CLOUD_SCANS',
    label: 'Cloud Scans',
    dependsOn: ['CLOUD_SECURITY'],
    defaultEnabled: true,
    posthogKey: 'ff_cloud_scans',
  },

  // ── Attack Surface Management ──────────────────────────────────
  ASM: {
    key: 'ASM',
    label: 'Attack Surface Management',
    defaultEnabled: true,
    posthogKey: 'ff_asm',
    buildTimeEnv: 'VITE_FF_ASM',
  },
  ASM_DOMAINS: {
    key: 'ASM_DOMAINS',
    label: 'ASM Domains',
    dependsOn: ['ASM'],
    defaultEnabled: true,
    posthogKey: 'ff_asm_domains',
  },
  ASM_ASSETS: {
    key: 'ASM_ASSETS',
    label: 'ASM Assets',
    dependsOn: ['ASM'],
    defaultEnabled: true,
    posthogKey: 'ff_asm_assets',
  },
  ASM_SCANS: {
    key: 'ASM_SCANS',
    label: 'ASM Scans',
    dependsOn: ['ASM'],
    defaultEnabled: true,
    posthogKey: 'ff_asm_scans',
  },

  // ── Security Dashboard ─────────────────────────────────────────
  SECURITY_DASHBOARD: {
    key: 'SECURITY_DASHBOARD',
    label: 'Security Dashboard',
    defaultEnabled: true,
    posthogKey: 'ff_security_dashboard',
  },

  // ── Settings & Management ──────────────────────────────────────
  INTEGRATIONS: {
    key: 'INTEGRATIONS',
    label: 'Integrations',
    defaultEnabled: true,
    posthogKey: 'ff_integrations',
  },
  SECRETS: {
    key: 'SECRETS',
    label: 'Secrets Manager',
    defaultEnabled: true,
    posthogKey: 'ff_secrets',
  },
  API_KEYS: {
    key: 'API_KEYS',
    label: 'API Keys',
    defaultEnabled: true,
    posthogKey: 'ff_api_keys',
  },
  MCP_SERVERS: {
    key: 'MCP_SERVERS',
    label: 'MCP Servers',
    defaultEnabled: true,
    posthogKey: 'ff_mcp_servers',
  },
  ARTIFACTS: {
    key: 'ARTIFACTS',
    label: 'Artifacts',
    defaultEnabled: true,
    posthogKey: 'ff_artifacts',
  },
  ACTION_CENTER: {
    key: 'ACTION_CENTER',
    label: 'Approvals',
    dependsOn: ['WORKFLOWS'],
    defaultEnabled: true,
    posthogKey: 'ff_action_center',
  },
  ANALYTICS_SETTINGS: {
    key: 'ANALYTICS_SETTINGS',
    label: 'Analytics Settings',
    defaultEnabled: true,
    posthogKey: 'ff_analytics_settings',
  },
};
