import type { SecurityViewFilter } from '@/config/securityViews';

// --- Types ---

export interface FindingLifecycle {
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export interface SecurityFinding {
  id: string;
  scanner: string;
  finding_hash: string;
  severity: string;
  status: string | null;
  title: string | null;
  description: string | null;
  region: string | null;
  asset_key: string | null;
  account_id: string | null;
  service_name: string | null;
  resource_tags: Record<string, string> | null;
  check_name: string | null;
  compliance: string[] | null;
  finding_types: string[] | null;
  remediationText: string | null;
  recommendationUrl: string | null;
  rule_id: string | null;
  file: string | null;
  line: number | null;
  snippet: string | null;
  workflow_id: string;
  workflow_name: string;
  run_id: string;
  component_id: string;
  trigger_source: string | null;
  timestamp: string;
}

export interface Filter {
  field: string;
  op: 'eq' | 'in' | 'gte' | 'lte' | 'like' | 'prefix' | 'not_eq' | 'exists' | 'not_exists';
  value?: unknown;
}

export interface SecurityDashboardFilters {
  account: string | null;
  severity: string[];
  status: string[];
  region: string[];
  service: string[];
  tags: string[];
  compliance: string[];
  checkName: string[];
  scanner: string[];
  repository: string[];
  ruleId: string[];
  file: string[];
  language: string[];
  search: string;
  from: string | null;
  to: string | null;
  page: number;
  sort: string;
  order: 'asc' | 'desc';
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface TimeSeriesBucket {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AggBucket {
  key: string;
  count: number;
}

export interface SecuritySummary {
  severityCounts: SeverityCounts;
  accounts: AggBucket[];
  regions: AggBucket[];
  services: AggBucket[];
  complianceFrameworks: AggBucket[];
  checkNames: AggBucket[];
  statusCounts: AggBucket[];
  scanners: AggBucket[];
  repositories: AggBucket[];
  ruleIds: AggBucket[];
  files: AggBucket[];
}

export interface SecurityFindingsResult {
  findings: SecurityFinding[];
  total: number;
  summary: SecuritySummary;
}

// --- Constants ---

export const PAGE_SIZE = 25;

export const INITIAL_FILTERS: SecurityDashboardFilters = {
  account: null,
  severity: [],
  status: [],
  region: [],
  service: [],
  tags: [],
  compliance: [],
  checkName: [],
  scanner: [],
  repository: [],
  ruleId: [],
  file: [],
  language: [],
  search: '',
  from: null,
  to: null,
  page: 1,
  sort: 'timestamp',
  order: 'desc',
};

export const INITIAL_SEVERITY_COUNTS: SeverityCounts = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
};

// --- Helpers ---

/** Scanners that emit a `status` field (e.g. FAILED / PASSED). */
const STATUS_AWARE_SCANNERS = new Set(['prowler', 'supabase-scanner']);

export function buildBaseFilter(
  filters: SecurityDashboardFilters,
  viewFilter?: SecurityViewFilter,
): { filters: Filter[]; search?: string } {
  const result: Filter[] = [];
  let search: string | undefined;

  if (viewFilter?.scannerTerms && viewFilter.scannerTerms.length > 0) {
    if (viewFilter.scannerTerms.length === 1) {
      result.push({ field: 'scanner', op: 'eq', value: viewFilter.scannerTerms[0] });
    } else {
      result.push({ field: 'scanner', op: 'in', value: viewFilter.scannerTerms });
    }
  }

  if (filters.search.trim()) {
    search = filters.search.trim();
  }

  if (filters.account) {
    result.push({ field: 'account_id', op: 'eq', value: filters.account });
  }

  if (filters.severity.length > 0) {
    result.push({ field: 'severity', op: 'in', value: filters.severity });
  }

  if (filters.status.length > 0) {
    const viewScanners = viewFilter?.scannerTerms ?? [];
    const allStatusAware =
      viewScanners.length > 0 && viewScanners.every((s) => STATUS_AWARE_SCANNERS.has(s));

    if (allStatusAware) {
      result.push({ field: 'status', op: 'in', value: filters.status });
    } else {
      // Mixed view: filter by status but also include findings with no status
      // Backend handles this with OR logic via two filters
      result.push({ field: 'status', op: 'in', value: [...filters.status, ''] });
    }
  }

  if (filters.region.length > 0) {
    result.push({ field: 'region', op: 'in', value: filters.region });
  }

  if (filters.service.length > 0) {
    result.push({ field: 'service_name', op: 'in', value: filters.service });
  }

  if (filters.tags.length > 0) {
    for (const tagKey of filters.tags) {
      result.push({ field: `resource_tags.${tagKey}`, op: 'exists' });
    }
  }

  if (filters.compliance.length > 0) {
    result.push({ field: 'compliance', op: 'in', value: filters.compliance });
  }

  if (filters.checkName.length > 0) {
    result.push({ field: 'check_name', op: 'in', value: filters.checkName });
  }

  if (filters.scanner.length > 0) {
    result.push({ field: 'scanner', op: 'in', value: filters.scanner });
  }

  if (filters.repository.length > 0) {
    result.push({ field: 'trigger_source', op: 'in', value: filters.repository });
  }

  if (filters.ruleId.length > 0) {
    result.push({ field: 'rule_id', op: 'in', value: filters.ruleId });
  }

  if (filters.file.length > 0) {
    result.push({ field: 'file', op: 'in', value: filters.file });
  }

  if (filters.language.length > 0) {
    for (const lang of filters.language) {
      result.push({ field: 'rule_id', op: 'prefix', value: `${lang}.` });
    }
  }

  if (filters.from) {
    result.push({ field: 'timestamp', op: 'gte', value: filters.from });
  }
  if (filters.to) {
    result.push({ field: 'timestamp', op: 'lte', value: filters.to });
  }

  return { filters: result, search };
}

export function buildSort(
  filters: SecurityDashboardFilters,
): { field: string; direction: 'asc' | 'desc' }[] {
  return [{ field: filters.sort, direction: filters.order }];
}

/** Infer scanner from document fields when not explicitly set */
function inferScanner(source: Record<string, any>): string {
  if (source.scanner) return source.scanner;
  if (source.account_id && source.service_name) return 'prowler';
  if (source.rule_id && source.file) return 'opengrep';
  if (source.detector_type || source.source_type) return 'trufflehog';
  return 'unknown';
}

const OPENGREP_ACRONYMS: Record<string, string> = {
  api: 'API',
  cors: 'CORS',
  csrf: 'CSRF',
  db: 'DB',
  dns: 'DNS',
  gcp: 'GCP',
  html: 'HTML',
  http: 'HTTP',
  https: 'HTTPS',
  iam: 'IAM',
  ip: 'IP',
  jwt: 'JWT',
  ldap: 'LDAP',
  md5: 'MD5',
  oidc: 'OIDC',
  os: 'OS',
  rce: 'RCE',
  rsa: 'RSA',
  saml: 'SAML',
  sast: 'SAST',
  sql: 'SQL',
  ssh: 'SSH',
  ssrf: 'SSRF',
  ssl: 'SSL',
  tls: 'TLS',
  url: 'URL',
  xml: 'XML',
  xss: 'XSS',
};

function humanizeOpenGrepRuleId(ruleId: string): string {
  const parts = ruleId.split('.').filter(Boolean);
  const slug = parts[parts.length - 1] || ruleId;
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return OPENGREP_ACRONYMS[lower] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}

function deriveFindingTitle(source: Record<string, any>, scanner: string): string | null {
  const rawTitle =
    typeof source.title === 'string' && source.title.trim().length > 0 ? source.title.trim() : null;
  const ruleId =
    typeof source.rule_id === 'string' && source.rule_id.trim().length > 0
      ? source.rule_id.trim()
      : null;

  if (scanner === 'opengrep' && ruleId && (!rawTitle || rawTitle === ruleId)) {
    return humanizeOpenGrepRuleId(ruleId);
  }

  return rawTitle;
}

/** Parse a flat result object from the analytics API into a SecurityFinding */
export function parseFinding(hit: Record<string, any>): SecurityFinding {
  const scanner = inferScanner(hit);
  return {
    id: hit.id ?? hit.finding_hash ?? '',
    scanner,
    finding_hash: hit.finding_hash ?? '',
    severity: hit.severity ?? 'unknown',
    status: hit.status ?? null,
    title: deriveFindingTitle(hit, scanner),
    description: hit.description ?? null,
    region: hit.region ?? null,
    asset_key: hit.asset_key ?? null,
    account_id: hit.account_id ?? null,
    service_name: hit.service_name ?? null,
    resource_tags: hit.resource_tags ?? null,
    check_name: hit.check_name ?? null,
    compliance: hit.compliance ?? null,
    finding_types: hit.finding_types ?? null,
    remediationText: hit.remediationText ?? null,
    recommendationUrl: hit.recommendationUrl ?? null,
    rule_id: hit.rule_id ?? null,
    file: hit.file ?? null,
    line: hit.line ?? null,
    snippet: hit.snippet ?? null,
    workflow_id: hit.workflow_id ?? '',
    workflow_name: hit.workflow_name ?? '',
    run_id: hit.run_id ?? '',
    component_id: hit.component_id ?? '',
    trigger_source: hit.trigger_source ?? null,
    timestamp: hit.timestamp ?? '',
  };
}

/** Parse severity count aggregation into a SeverityCounts object */
export function parseSeverityCounts(buckets: AggBucket[]): SeverityCounts {
  const counts = { ...INITIAL_SEVERITY_COUNTS };
  for (const bucket of buckets) {
    const key = bucket.key?.toLowerCase();
    if (key in counts) {
      counts[key as keyof SeverityCounts] = bucket.count;
    }
  }
  return counts;
}
