import { ShieldAlert, ShieldCheck, ShieldX, Shield } from 'lucide-react';

export const PAGE_SIZE = 25;

export const SEVERITY_CONFIG = [
  { key: 'critical', label: 'Critical', color: 'bg-red-500', chartColor: '#ef4444', icon: ShieldX },
  { key: 'high', label: 'High', color: 'bg-orange-500', chartColor: '#f97316', icon: ShieldAlert },
  { key: 'medium', label: 'Medium', color: 'bg-yellow-500', chartColor: '#eab308', icon: Shield },
  { key: 'low', label: 'Low', color: 'bg-slate-500', chartColor: '#64748b', icon: ShieldCheck },
  { key: 'info', label: 'Info', color: 'bg-blue-500', chartColor: '#3b82f6', icon: ShieldCheck },
] as const;

export const TIME_RANGES = [
  { key: '1h', label: '1h', days: 1 / 24, interval: 'minute' },
  { key: '6h', label: '6h', days: 0.25, interval: 'minute' },
  { key: '1d', label: '1d', days: 1, interval: 'hour' },
  { key: '7d', label: '7d', days: 7, interval: '6h' },
  { key: '30d', label: '30d', days: 30, interval: 'day' },
  { key: '90d', label: '90d', days: 90, interval: 'day' },
] as const;

export const QUICK_SCANS = [
  {
    id: 'secret-detection',
    templateSlug: 'sys-secret-scan',
    name: 'Secret Detection',
    description: 'Scan for exposed secrets, API keys, and credentials',
    icon: Shield,
  },
  {
    id: 'sast-semgrep',
    templateSlug: 'sys-sast-scan',
    name: 'SAST',
    description: 'Static Application Security Testing',
    icon: Shield,
  },
  {
    id: 'dependency-audit',
    templateSlug: 'sys-dependency-scan',
    name: 'Dependency Audit',
    description: 'Check dependencies for known vulnerabilities',
    icon: Shield,
  },
];

export const CODE_SCHEDULE_SCANS = [
  ...QUICK_SCANS,
  {
    id: 'full-code-security',
    templateSlug: 'sys-full-code-security',
    name: 'Full Code Security',
    description: 'Secret Detection + SAST + Dependency Audit',
    icon: ShieldCheck,
  },
];

export const ASM_SCHEDULE_SCANS = [
  {
    id: 'attack-surface-recon',
    templateSlug: 'sys-attack-surface-recon',
    name: 'Attack Surface Recon',
    description: 'Subdomain discovery, DNS resolution, HTTP probing & enrichment',
    icon: Shield,
  },
];
