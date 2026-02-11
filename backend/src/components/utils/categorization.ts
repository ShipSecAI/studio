import type { ComponentDefinition, ComponentCategory } from '@shipsec/component-sdk';

export interface ComponentCategoryConfig {
  label: string;
  color: string;
  description: string;
  emoji: string;
  icon: string;
}

const SUPPORTED_CATEGORIES: readonly ComponentCategory[] = [
  'input',
  'transform',
  'ai',
  'mcp',
  'security',
  'scanners',
  'it_ops',
  'notification',
  'manual_action',
  'output',
];

const COMPONENT_CATEGORY_CONFIG: Record<ComponentCategory, ComponentCategoryConfig> = {
  input: {
    label: 'Input',
    color: 'text-blue-600',
    description: 'Data sources, triggers, and credential access',
    emoji: '📥',
    icon: 'Download',
  },
  transform: {
    label: 'Transform',
    color: 'text-orange-600',
    description: 'Data processing, text manipulation, and formatting',
    emoji: '🔄',
    icon: 'RefreshCw',
  },
  ai: {
    label: 'AI Components',
    color: 'text-violet-600',
    description: 'AI-powered analysis and generation tools',
    emoji: '🤖',
    icon: 'Brain',
  },
  mcp: {
    label: 'MCP Servers',
    color: 'text-teal-600',
    description: 'Model Context Protocol servers and tool gateways',
    emoji: '🔌',
    icon: 'Plug',
  },
  security: {
    label: 'Security Tools',
    color: 'text-red-600',
    description: 'Security scanning and assessment tools',
    emoji: '🔒',
    icon: 'Shield',
  },
  scanners: {
    label: 'Scanners',
    color: 'text-rose-600',
    description: 'Code and secret scanning tools',
    emoji: '🔍',
    icon: 'Search',
  },
  it_ops: {
    label: 'IT Ops',
    color: 'text-cyan-600',
    description: 'IT operations and user management workflows',
    emoji: '🏢',
    icon: 'Building',
  },
  notification: {
    label: 'Notification',
    color: 'text-pink-600',
    description: 'Slack, Email, and other messaging alerts',
    emoji: '🔔',
    icon: 'Bell',
  },
  manual_action: {
    label: 'Manual Action',
    color: 'text-amber-600',
    description: 'Human-in-the-loop interactions, approvals, and manual tasks',
    emoji: '👤',
    icon: 'UserCheck',
  },
  output: {
    label: 'Output',
    color: 'text-green-600',
    description: 'Data export, notifications, and integrations',
    emoji: '📤',
    icon: 'Upload',
  },
};

function normalizeCategory(category?: string | null): ComponentCategory | null {
  if (!category) {
    return null;
  }

  const normalized = category.toLowerCase();

  if (SUPPORTED_CATEGORIES.includes(normalized as ComponentCategory)) {
    return normalized as ComponentCategory;
  }

  return null;
}

export function categorizeComponent(component: ComponentDefinition): ComponentCategory {
  const fromMetadata = normalizeCategory(component.ui?.category);
  if (fromMetadata) {
    return fromMetadata;
  }

  const fromDefinition = normalizeCategory(component.category);
  if (fromDefinition) {
    return fromDefinition;
  }

  return 'input';
}

export function getCategoryConfig(category: ComponentCategory): ComponentCategoryConfig {
  return COMPONENT_CATEGORY_CONFIG[category];
}
