import {
  Home,
  Activity,
  MessageSquare,
  Workflow,
  LayoutTemplate,
  CalendarClock,
  Webhook,
  Zap,
  Plug,
  Archive,
  KeyRound,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ServerCog,
  Settings,
  Globe,
  Server,
  Radar,
  ScanSearch,
  Cloud,
  GitPullRequest,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';

export interface PageTitleConfig {
  /** Full title shown on desktop */
  title: string;
  /** Shortened title for mobile breadcrumb */
  shortTitle: string;
  /** Subtitle / description shown in some contexts */
  subtitle: string;
  /** Lucide icon matching sidebar navigation */
  icon?: LucideIcon;
  /** Optional breadcrumb for sub-pages */
  breadcrumb?: { label: string; href: string };
}

/**
 * Centralized page title definitions keyed by route pattern.
 *
 * Route matching order matters: more-specific patterns are checked first
 * via the `resolvePageTitle` helper below.
 */
const PAGE_TITLES: Record<string, PageTitleConfig> = {
  '/': {
    title: 'Home',
    shortTitle: 'Home',
    subtitle: 'Security posture overview and onboarding',
    icon: Home,
  },
  '/chat': {
    title: 'ShipSec AI',
    shortTitle: 'AI',
    subtitle: 'Chat with your security AI assistant',
    icon: MessageSquare,
  },
  '/activity': {
    title: 'Activity',
    shortTitle: 'Activity',
    subtitle: 'Workflow execution history and monitoring',
    icon: Activity,
  },
  '/builder': {
    title: 'Workflow Builder',
    shortTitle: 'Builder',
    subtitle: 'Create and manage security automation workflows',
    icon: Workflow,
  },
  '/workflows': {
    title: 'Workflow Builder',
    shortTitle: 'Builder',
    subtitle: 'Design and automate security workflows',
    icon: Workflow,
  },
  '/templates': {
    title: 'Workflow Templates',
    shortTitle: 'Templates',
    subtitle: 'Browse and use pre-built workflow templates',
    icon: LayoutTemplate,
  },
  '/schedules': {
    title: 'Workflow Schedules',
    shortTitle: 'Schedules',
    subtitle: 'Manage recurring workflow cadences',
    icon: CalendarClock,
  },
  '/webhooks': {
    title: 'Webhooks',
    shortTitle: 'Webhooks',
    subtitle: 'Manage and debug incoming webhooks',
    icon: Webhook,
  },
  '/action-center': {
    title: 'Approvals',
    shortTitle: 'Approvals',
    subtitle: 'Review paused workflow requests and human-in-the-loop decisions',
    icon: Zap,
  },
  '/integrations': {
    title: 'Integrations',
    shortTitle: 'Integrations',
    subtitle:
      'Connect external services to enable cloud security scanning, notifications, and more',
    icon: Plug,
  },
  '/artifacts': {
    title: 'Artifacts',
    shortTitle: 'Artifacts',
    subtitle: 'Browse workflow outputs, files, and evidence saved across runs',
    icon: Archive,
  },
  '/secrets': {
    title: 'Secrets',
    shortTitle: 'Secrets',
    subtitle: 'Store and manage sensitive credentials',
    icon: KeyRound,
  },
  '/api-keys': {
    title: 'API Keys',
    shortTitle: 'API Keys',
    subtitle: 'Manage API keys for workflow triggers',
    icon: Shield,
  },
  '/mcp-library': {
    title: 'MCP Servers',
    shortTitle: 'MCP',
    subtitle: 'Manage Model Context Protocol server configurations',
    icon: ServerCog,
  },
  '/analytics-settings': {
    title: 'Analytics Settings',
    shortTitle: 'Analytics',
    subtitle: 'Configure data retention and storage settings',
    icon: Settings,
  },
  '/settings/audit': {
    title: 'Audit Logs',
    shortTitle: 'Audit',
    subtitle: 'Review organization audit activity',
    icon: ShieldCheck,
  },
  '/settings': {
    title: 'Settings',
    shortTitle: 'Settings',
    subtitle: 'Application settings and preferences',
    icon: Settings,
  },
  '/github/repositories': {
    title: 'Repositories',
    shortTitle: 'Repos',
    subtitle: 'Manage repositories, trigger rules, and scan results',
    breadcrumb: { label: 'GitHub', href: '/github/repositories' },
  },
  '/github/scans': {
    title: 'Scan Results',
    shortTitle: 'Scans',
    subtitle: 'View code security scan results',
    icon: ScanSearch,
    breadcrumb: { label: 'GitHub', href: '/github/repositories' },
  },
  '/github/triggers': {
    title: 'PR Protection',
    shortTitle: 'Triggers',
    subtitle: 'Configure automated PR security scans',
    icon: GitPullRequest,
    breadcrumb: { label: 'GitHub', href: '/github/repositories' },
  },
  '/github': {
    title: 'GitHub',
    shortTitle: 'GitHub',
    subtitle: 'Manage repositories, trigger rules, and scan results',
  },
  '/cloud/accounts': {
    title: 'Cloud Accounts',
    shortTitle: 'Cloud',
    subtitle: 'Manage your AWS accounts and run cloud security scans',
    icon: Cloud,
  },
  '/cloud/inventory': {
    title: 'Cloud Inventory',
    shortTitle: 'Inventory',
    subtitle: 'Browse cloud resources across your accounts',
    icon: Server,
  },
  '/cloud/scans': {
    title: 'Cloud Scans',
    shortTitle: 'Scans',
    subtitle: 'View cloud security scan history',
    icon: ScanSearch,
  },
  '/dashboards/security': {
    title: 'ShipSec Sentinel',
    shortTitle: 'Sentinel',
    subtitle: 'Legacy findings dashboard redirected to Sentinel',
    icon: ShieldAlert,
  },
  '/findings': {
    title: 'ShipSec Sentinel',
    shortTitle: 'Sentinel',
    subtitle: 'Threat stories, relevant findings, and hidden scanner noise',
    icon: ShieldAlert,
  },
  '/stories': {
    title: 'ShipSec Sentinel',
    shortTitle: 'Sentinel',
    subtitle: 'Threat stories, relevant findings, and hidden scanner noise',
    icon: ShieldAlert,
  },
  '/security-wiki': {
    title: 'Security Wiki',
    shortTitle: 'Wiki',
    subtitle: 'Living company security memory for agents and humans',
    icon: BookOpen,
  },
  '/asm/domains': {
    title: 'Domains',
    shortTitle: 'Domains',
    subtitle: 'Manage your attack surface domains',
    icon: Globe,
  },
  '/asm/assets': {
    title: 'Assets',
    shortTitle: 'Assets',
    subtitle: 'Discovered attack surface assets',
    icon: Server,
  },
  '/asm/scans': {
    title: 'Scans',
    shortTitle: 'Scans',
    subtitle: 'Attack surface scan history',
    icon: Radar,
  },
};

/** Fallback when no route matches */
const DEFAULT_PAGE_TITLE: PageTitleConfig = {
  title: 'ShipSec Studio',
  shortTitle: 'Studio',
  subtitle: '',
};

/**
 * Resolve the page title config for a given pathname.
 *
 * Matching strategy (in order):
 *  1. Exact match  (e.g. `/action-center`)
 *  2. Prefix match (e.g. `/workflows/abc` matches `/workflows`)
 *
 * Feature-gated routes (connections, analytics) are handled gracefully:
 * the config entry always exists but the route itself is only registered
 * when the feature flag is on, so no extra gating is needed here.
 */
export function resolvePageTitle(pathname: string): PageTitleConfig {
  // 1. Exact match
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname];
  }

  // 2. Dynamic route handling for /integrations/:provider
  if (pathname.startsWith('/integrations/') && pathname !== '/integrations/callback') {
    const provider = pathname.split('/')[2];
    if (provider) {
      const providerName =
        provider.toUpperCase() === 'AWS'
          ? 'AWS'
          : provider.charAt(0).toUpperCase() + provider.slice(1);
      return {
        title: `Integrations / ${providerName}`,
        shortTitle: providerName,
        subtitle:
          'Connect external services to enable cloud security scanning, notifications, and more',
        icon: Plug,
        breadcrumb: { label: 'Integrations', href: '/integrations' },
      };
    }
  }

  // 3. Prefix match — longest prefix wins
  let bestMatch: PageTitleConfig | null = null;
  let bestLength = 0;

  for (const [pattern, config] of Object.entries(PAGE_TITLES)) {
    if (pattern === '/') continue; // skip root for prefix matching
    if (pathname.startsWith(pattern) && pattern.length > bestLength) {
      bestMatch = config;
      bestLength = pattern.length;
    }
  }

  if (bestMatch) return bestMatch;

  return DEFAULT_PAGE_TITLE;
}
