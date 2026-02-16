import {
  MessageSquare,
  Workflow,
  CalendarClock,
  Webhook,
  Zap,
  Plug,
  Archive,
  KeyRound,
  Shield,
  ServerCog,
  Settings,
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
}

/**
 * Centralized page title definitions keyed by route pattern.
 *
 * Route matching order matters: more-specific patterns are checked first
 * via the `resolvePageTitle` helper below.
 */
const PAGE_TITLES: Record<string, PageTitleConfig> = {
  '/': {
    title: 'ShipSec AI',
    shortTitle: 'AI',
    subtitle: 'Chat with your security AI assistant',
    icon: MessageSquare,
  },
  '/workflows': {
    title: 'Workflow Builder',
    shortTitle: 'Workflows',
    subtitle: 'Create and manage security automation workflows',
    icon: Workflow,
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
    title: 'Action Center',
    shortTitle: 'Actions',
    subtitle: 'Review and respond to workflow requests',
    icon: Zap,
  },
  '/integrations': {
    title: 'Connections',
    shortTitle: 'Connections',
    subtitle: 'Manage OAuth tokens for external providers',
    icon: Plug,
  },
  '/artifacts': {
    title: 'Artifact Library',
    shortTitle: 'Artifacts',
    subtitle: 'Browse artifacts saved across workflow runs',
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

  // 2. Prefix match — longest prefix wins
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
