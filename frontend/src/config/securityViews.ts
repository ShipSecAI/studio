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

export interface SecurityViewFilter {
  /** Scanner values to filter by (e.g. ['prowler']). Empty/undefined = all scanners. */
  scannerTerms?: string[];
}

export interface SecurityViewDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  builtIn: boolean;
  disabled?: boolean;
  baseFilter: SecurityViewFilter;
  order: number;
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
  },
  {
    id: 'all-findings',
    label: 'All Findings',
    icon: Shield,
    builtIn: true,
    baseFilter: {},
    order: 0,
  },
  {
    id: 'cloud-security',
    label: 'Cloud Security',
    icon: ShieldCheck,
    builtIn: true,
    baseFilter: { scannerTerms: ['prowler', 'supabase-scanner'] },
    order: 1,
  },
  {
    id: 'code-security',
    label: 'Code Security',
    icon: Code,
    builtIn: true,
    baseFilter: { scannerTerms: ['opengrep', 'trufflehog'] },
    order: 2,
  },
  {
    id: 'dependency-security',
    label: 'Dependency Security',
    icon: Package,
    builtIn: true,
    baseFilter: { scannerTerms: ['dependency', 'trivy'] },
    order: 3,
  },
  {
    id: 'container-security',
    label: 'Container Security',
    icon: Container,
    builtIn: true,
    baseFilter: { scannerTerms: ['trivy-container', 'grype'] },
    order: 4,
  },
  {
    id: 'surface-security',
    label: 'Surface Security',
    icon: Globe,
    builtIn: true,
    baseFilter: { scannerTerms: ['subfinder', 'dnsx', 'httpx', 'naabu', 'nuclei', 'amass'] },
    order: 5,
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: AlertTriangle,
    builtIn: true,
    disabled: true,
    baseFilter: {},
    order: 6,
  },
];

/** Look up a built-in view by ID */
export function getBuiltInView(id: string): SecurityViewDefinition | undefined {
  return BUILT_IN_VIEWS.find((v) => v.id === id);
}
