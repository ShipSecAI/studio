import {
  Home,
  Shield,
  ShieldCheck,
  Code,
  Package,
  Container,
  AlertTriangle,
  Globe,
  type LucideIcon,
} from 'lucide-react';

export type SecurityViewId =
  | 'home'
  | 'all-findings'
  | 'cloud-security'
  | 'code-security'
  | 'dependency-security'
  | 'container-security'
  | 'surface-security'
  | 'incidents';

const VALID_VIEW_IDS = new Set<string>([
  'home',
  'all-findings',
  'cloud-security',
  'code-security',
  'dependency-security',
  'container-security',
  'surface-security',
  'incidents',
]);

export function isValidViewId(id: string): id is SecurityViewId {
  return VALID_VIEW_IDS.has(id);
}

export type SecurityColumnKey =
  | 'status'
  | 'repository'
  | 'scanner'
  | 'service'
  | 'region'
  | 'account'
  | 'host'
  | 'firstSeen';

export type SecurityFilterKey =
  | 'severity'
  | 'status'
  | 'region'
  | 'service'
  | 'compliance'
  | 'check'
  | 'tags'
  | 'scanner'
  | 'repository'
  | 'rule'
  | 'file'
  | 'language'
  | 'account';

/** Maps UI filter keys to SecurityDashboardFilters store keys */
export const FILTER_KEY_TO_STORE_KEY: Record<SecurityFilterKey, string> = {
  severity: 'severity',
  status: 'status',
  region: 'region',
  service: 'service',
  compliance: 'compliance',
  check: 'checkName',
  tags: 'tags',
  scanner: 'scanner',
  repository: 'repository',
  rule: 'ruleId',
  file: 'file',
  language: 'language',
  account: 'account',
};

export interface SecurityViewUiConfig {
  columns: SecurityColumnKey[];
  filters: SecurityFilterKey[];
  showAccountTabs?: boolean;
}

export interface SecurityViewFilter {
  /** Scanner values to filter by (e.g. ['prowler']). Empty/undefined = all scanners. */
  scannerTerms?: string[];
}

export interface SecurityViewDefinition {
  id: SecurityViewId;
  label: string;
  icon: LucideIcon;
  builtIn: boolean;
  disabled?: boolean;
  baseFilter: SecurityViewFilter;
  order: number;
  uiConfig: SecurityViewUiConfig;
}

/**
 * Built-in security views provided by the platform.
 * Scanner values come from worker/src/components/security/findings-normalize.ts
 */
export const BUILT_IN_VIEWS: SecurityViewDefinition[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    builtIn: true,
    baseFilter: {},
    order: -1,
    uiConfig: {
      filters: ['severity', 'status', 'scanner', 'compliance', 'check', 'tags'],
      columns: ['status', 'scanner', 'firstSeen'],
    },
  },
  {
    id: 'all-findings',
    label: 'All Findings',
    icon: Shield,
    builtIn: true,
    baseFilter: {},
    order: 0,
    uiConfig: {
      filters: [
        'severity',
        'status',
        'region',
        'service',
        'scanner',
        'compliance',
        'check',
        'tags',
      ],
      columns: ['status', 'scanner', 'firstSeen'],
    },
  },
  {
    id: 'cloud-security',
    label: 'Cloud Security',
    icon: ShieldCheck,
    builtIn: true,
    baseFilter: { scannerTerms: ['prowler', 'supabase-scanner'] },
    order: 1,
    uiConfig: {
      filters: [
        'severity',
        'status',
        'region',
        'service',
        'compliance',
        'check',
        'tags',
        'account',
      ],
      columns: ['status', 'service', 'region', 'account', 'firstSeen'],
      showAccountTabs: true,
    },
  },
  {
    id: 'code-security',
    label: 'Code Security',
    icon: Code,
    builtIn: true,
    baseFilter: { scannerTerms: ['opengrep', 'trufflehog'] },
    order: 2,
    uiConfig: {
      filters: ['severity', 'language', 'scanner', 'repository', 'rule', 'file'],
      columns: ['repository', 'scanner', 'firstSeen'],
    },
  },
  {
    id: 'dependency-security',
    label: 'Dependency Security',
    icon: Package,
    builtIn: true,
    baseFilter: { scannerTerms: ['dependency', 'trivy'] },
    order: 3,
    uiConfig: {
      filters: ['severity', 'scanner', 'repository'],
      columns: ['scanner', 'repository', 'firstSeen'],
    },
  },
  {
    id: 'container-security',
    label: 'Container Security',
    icon: Container,
    builtIn: true,
    baseFilter: { scannerTerms: ['trivy-container', 'grype'] },
    order: 4,
    uiConfig: {
      filters: ['severity', 'scanner'],
      columns: ['scanner', 'firstSeen'],
    },
  },
  {
    id: 'surface-security',
    label: 'Surface Security',
    icon: Globe,
    builtIn: true,
    baseFilter: { scannerTerms: ['subfinder', 'dnsx', 'httpx', 'naabu', 'nuclei', 'amass'] },
    order: 5,
    uiConfig: {
      filters: ['severity', 'scanner'],
      columns: ['scanner', 'host', 'firstSeen'],
    },
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: AlertTriangle,
    builtIn: true,
    disabled: true,
    baseFilter: {},
    order: 6,
    uiConfig: {
      filters: ['severity', 'status'],
      columns: ['status', 'scanner', 'firstSeen'],
    },
  },
];

/** Look up a built-in view by ID */
export function getBuiltInView(id: string): SecurityViewDefinition | undefined {
  return BUILT_IN_VIEWS.find((v) => v.id === id);
}
