export const COMPONENT_CATEGORIES = [
  'input',
  'transform',
  'ai',
  'mcp',
  'security',
  'it_ops',
  'notification',
  'manual_action',
  'output',
  'process',
  'cloud',
  'core',
] as const;

export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export const DEFAULT_COMPONENT_CATEGORY: ComponentCategory = 'input';

export interface CategoryColorToken {
  light: string;
  dark: string;
}

export interface ComponentCategoryDescriptor {
  label: string;
  description: string;
  emoji: string;
  icon: string;
  color: string;
  textColorClass: string;
  separatorColor: CategoryColorToken;
  headerBackgroundColor: CategoryColorToken;
}

export const COMPONENT_CATEGORY_DESCRIPTORS: Record<ComponentCategory, ComponentCategoryDescriptor> = {
  input: {
    label: 'Input',
    description: 'Data sources, triggers, and credential access',
    emoji: '📥',
    icon: 'Download',
    color: 'text-blue-600',
    textColorClass: 'text-blue-600 dark:text-blue-400',
    separatorColor: {
      light: 'rgb(147 197 253)',
      dark: 'rgb(147 197 253)',
    },
    headerBackgroundColor: {
      light: 'rgb(250 252 255)',
      dark: 'rgb(23 37 84 / 0.15)',
    },
  },
  transform: {
    label: 'Transform',
    description: 'Data processing, text manipulation, and formatting',
    emoji: '🔄',
    icon: 'RefreshCw',
    color: 'text-orange-600',
    textColorClass: 'text-orange-600 dark:text-orange-400',
    separatorColor: {
      light: 'rgb(253 186 116)',
      dark: 'rgb(253 186 116)',
    },
    headerBackgroundColor: {
      light: 'rgb(255 251 250)',
      dark: 'rgb(69 10 10 / 0.15)',
    },
  },
  ai: {
    label: 'AI Components',
    description: 'AI-powered analysis and generation tools',
    emoji: '🤖',
    icon: 'Brain',
    color: 'text-violet-600',
    textColorClass: 'text-violet-600 dark:text-violet-400',
    separatorColor: {
      light: 'rgb(196 181 253)',
      dark: 'rgb(196 181 253)',
    },
    headerBackgroundColor: {
      light: 'rgb(253 250 255)',
      dark: 'rgb(36 25 50 / 0.15)',
    },
  },
  mcp: {
    label: 'MCP Servers',
    description: 'Model Context Protocol servers and tool gateways',
    emoji: '🔌',
    icon: 'Plug',
    color: 'text-teal-600',
    textColorClass: 'text-teal-600 dark:text-teal-400',
    separatorColor: {
      light: 'rgb(153 246 228)',
      dark: 'rgb(94 234 212)',
    },
    headerBackgroundColor: {
      light: 'rgb(247 254 253)',
      dark: 'rgb(19 78 74 / 0.15)',
    },
  },
  security: {
    label: 'Security Tools',
    description: 'Security scanning and assessment tools',
    emoji: '🔒',
    icon: 'Shield',
    color: 'text-red-600',
    textColorClass: 'text-red-600 dark:text-red-400',
    separatorColor: {
      light: 'rgb(252 165 165)',
      dark: 'rgb(252 165 165)',
    },
    headerBackgroundColor: {
      light: 'rgb(255 250 250)',
      dark: 'rgb(69 10 10 / 0.15)',
    },
  },
  it_ops: {
    label: 'IT Ops',
    description: 'IT operations and user management workflows',
    emoji: '🏢',
    icon: 'Building',
    color: 'text-cyan-600',
    textColorClass: 'text-cyan-600 dark:text-cyan-400',
    separatorColor: {
      light: 'rgb(103 232 249)',
      dark: 'rgb(103 232 249)',
    },
    headerBackgroundColor: {
      light: 'rgb(250 254 255)',
      dark: 'rgb(22 78 99 / 0.15)',
    },
  },
  notification: {
    label: 'Notification',
    description: 'Slack, Email, and other messaging alerts',
    emoji: '🔔',
    icon: 'Bell',
    color: 'text-pink-600',
    textColorClass: 'text-pink-600 dark:text-pink-400',
    separatorColor: {
      light: 'rgb(249 168 212)',
      dark: 'rgb(249 168 212)',
    },
    headerBackgroundColor: {
      light: 'rgb(255 250 253)',
      dark: 'rgb(80 7 36 / 0.15)',
    },
  },
  manual_action: {
    label: 'Manual Action',
    description: 'Human-in-the-loop interactions, approvals, and manual tasks',
    emoji: '👤',
    icon: 'UserCheck',
    color: 'text-amber-600',
    textColorClass: 'text-amber-600 dark:text-amber-400',
    separatorColor: {
      light: 'rgb(252 211 77)',
      dark: 'rgb(252 211 77)',
    },
    headerBackgroundColor: {
      light: 'rgb(255 254 250)',
      dark: 'rgb(120 53 15 / 0.15)',
    },
  },
  output: {
    label: 'Output',
    description: 'Data export, notifications, and integrations',
    emoji: '📤',
    icon: 'Upload',
    color: 'text-green-600',
    textColorClass: 'text-green-600 dark:text-green-400',
    separatorColor: {
      light: 'rgb(134 239 172)',
      dark: 'rgb(134 239 172)',
    },
    headerBackgroundColor: {
      light: 'rgb(250 255 250)',
      dark: 'rgb(20 83 45 / 0.15)',
    },
  },
  process: {
    label: 'Process',
    description: 'Data processing and transformation steps',
    emoji: '⚙️',
    icon: 'Cog',
    color: 'text-slate-600',
    textColorClass: 'text-slate-600 dark:text-slate-400',
    separatorColor: {
      light: 'rgb(148 163 184)',
      dark: 'rgb(148 163 184)',
    },
    headerBackgroundColor: {
      light: 'rgb(248 250 252)',
      dark: 'rgb(30 41 59 / 0.2)',
    },
  },
  cloud: {
    label: 'Cloud',
    description: 'Cloud provider integrations and services',
    emoji: '☁️',
    icon: 'Cloud',
    color: 'text-sky-600',
    textColorClass: 'text-sky-600 dark:text-sky-400',
    separatorColor: {
      light: 'rgb(125 211 252)',
      dark: 'rgb(125 211 252)',
    },
    headerBackgroundColor: {
      light: 'rgb(240 249 255)',
      dark: 'rgb(12 74 110 / 0.2)',
    },
  },
  core: {
    label: 'Core',
    description: 'Core platform utilities and credential management',
    emoji: '🔧',
    icon: 'Wrench',
    color: 'text-gray-600',
    textColorClass: 'text-gray-600 dark:text-gray-400',
    separatorColor: {
      light: 'rgb(209 213 219)',
      dark: 'rgb(156 163 175)',
    },
    headerBackgroundColor: {
      light: 'rgb(249 250 251)',
      dark: 'rgb(31 41 55 / 0.2)',
    },
  },
};

export const COMPONENT_CATEGORY_ORDER: readonly ComponentCategory[] = [
  'input',
  'core',
  'output',
  'notification',
  'security',
  'mcp',
  'cloud',
  'ai',
  'transform',
  'process',
  'it_ops',
  'manual_action',
];

export function isComponentCategory(value: string): value is ComponentCategory {
  return (COMPONENT_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeComponentCategory(value?: string | null): ComponentCategory | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isComponentCategory(normalized) ? normalized : null;
}

export function resolveComponentCategory(value?: string | null): ComponentCategory {
  return normalizeComponentCategory(value) ?? DEFAULT_COMPONENT_CATEGORY;
}

export function getComponentCategoryDescriptor(category?: string | null): ComponentCategoryDescriptor {
  return COMPONENT_CATEGORY_DESCRIPTORS[resolveComponentCategory(category)];
}

export function compareComponentCategoryOrder(a: string, b: string): number {
  const indexA = isComponentCategory(a) ? COMPONENT_CATEGORY_ORDER.indexOf(a) : -1;
  const indexB = isComponentCategory(b) ? COMPONENT_CATEGORY_ORDER.indexOf(b) : -1;
  if (indexA === -1 && indexB === -1) return 0;
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
}
