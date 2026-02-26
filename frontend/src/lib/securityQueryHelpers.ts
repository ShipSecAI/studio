import type { SecurityViewFilter } from '@/config/securityViews';

// --- Types ---

export interface FindingLifecycle {
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

export interface SecurityFinding {
  _id: string;
  scanner: string;
  finding_hash: string;
  severity: string;
  status: string;
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
  shipsec: {
    workflow_id: string;
    workflow_name: string;
    run_id: string;
    component_id: string;
    trigger_source?: string | null;
  };
  '@timestamp': string;
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
  doc_count: number;
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
  sort: '@timestamp',
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

export function buildBaseFilter(
  filters: SecurityDashboardFilters,
  viewFilter?: SecurityViewFilter,
) {
  const must: Record<string, any>[] = [];

  if (viewFilter?.scannerTerms && viewFilter.scannerTerms.length > 0) {
    if (viewFilter.scannerTerms.length === 1) {
      must.push({ term: { 'scanner.keyword': viewFilter.scannerTerms[0] } });
    } else {
      must.push({ terms: { 'scanner.keyword': viewFilter.scannerTerms } });
    }
  }

  if (filters.search.trim()) {
    must.push({
      multi_match: {
        query: filters.search.trim(),
        fields: ['title', 'description'],
      },
    });
  }

  const filter: Record<string, any>[] = [];

  if (filters.account) {
    filter.push({ term: { 'account_id.keyword': filters.account } });
  }

  if (filters.severity.length > 0) {
    filter.push({ terms: { 'severity.keyword': filters.severity } });
  }

  if (filters.status.length > 0) {
    filter.push({ terms: { 'status.keyword': filters.status } });
  }

  if (filters.region.length > 0) {
    filter.push({ terms: { 'region.keyword': filters.region } });
  }

  if (filters.service.length > 0) {
    filter.push({ terms: { 'service_name.keyword': filters.service } });
  }

  if (filters.tags.length > 0) {
    for (const tagKey of filters.tags) {
      filter.push({ exists: { field: `resource_tags.${tagKey}` } });
    }
  }

  if (filters.compliance.length > 0) {
    filter.push({ terms: { 'compliance.keyword': filters.compliance } });
  }

  if (filters.checkName.length > 0) {
    filter.push({ terms: { 'check_name.keyword': filters.checkName } });
  }

  if (filters.scanner.length > 0) {
    filter.push({ terms: { 'scanner.keyword': filters.scanner } });
  }

  if (filters.repository.length > 0) {
    filter.push({ terms: { 'shipsec.trigger_source.keyword': filters.repository } });
  }

  if (filters.ruleId.length > 0) {
    filter.push({ terms: { 'rule_id.keyword': filters.ruleId } });
  }

  if (filters.file.length > 0) {
    filter.push({ terms: { 'file.keyword': filters.file } });
  }

  if (filters.language.length > 0) {
    // Language is derived from rule_id prefix (e.g. "php" matches "php.*")
    filter.push({
      bool: {
        should: filters.language.map((lang) => ({
          prefix: { 'rule_id.keyword': `${lang}.` },
        })),
        minimum_should_match: 1,
      },
    });
  }

  if (filters.from || filters.to) {
    const range: Record<string, any> = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    filter.push({ range: { '@timestamp': range } });
  }

  return { bool: { must, filter } };
}

// Fields that use dynamic mapping (text + keyword sub-field) — need .keyword for sorting
const TEXT_FIELDS_WITH_KEYWORD = new Set([
  'severity',
  'status',
  'scanner',
  'region',
  'service_name',
  'check_name',
]);

export function buildSort(filters: SecurityDashboardFilters): Record<string, any>[] {
  let field: string;
  if (filters.sort === '@timestamp') {
    field = '@timestamp';
  } else if (TEXT_FIELDS_WITH_KEYWORD.has(filters.sort)) {
    field = `${filters.sort}.keyword`;
  } else {
    field = `${filters.sort}.keyword`;
  }
  return [{ [field]: filters.order }];
}

/** Infer scanner from document fields when not explicitly set */
function inferScanner(source: Record<string, any>): string {
  if (source.scanner) return source.scanner;
  // Cloud findings (prowler) have account_id + service_name
  if (source.account_id && source.service_name) return 'prowler';
  // Code findings from opengrep have rule_id + file
  if (source.rule_id && source.file) return 'opengrep';
  // Secret findings from trufflehog have detector_type or source_type
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

  // OpenGrep findings are often indexed with title === rule_id, which is not user-friendly.
  if (scanner === 'opengrep' && ruleId && (!rawTitle || rawTitle === ruleId)) {
    return humanizeOpenGrepRuleId(ruleId);
  }

  return rawTitle;
}

/** Parse a hit from the analytics API into a SecurityFinding */
export function parseFinding(hit: any): SecurityFinding {
  const scanner = inferScanner(hit._source);
  return {
    _id: hit._id,
    scanner,
    finding_hash: hit._source.finding_hash ?? '',
    severity: hit._source.severity ?? 'unknown',
    status: hit._source.status ?? 'UNKNOWN',
    title: deriveFindingTitle(hit._source, scanner),
    description: hit._source.description ?? null,
    region: hit._source.region ?? null,
    asset_key: hit._source.asset_key ?? null,
    account_id: hit._source.account_id ?? null,
    service_name: hit._source.service_name ?? null,
    resource_tags: hit._source.resource_tags ?? null,
    check_name: hit._source.check_name ?? null,
    compliance: hit._source.compliance ?? null,
    finding_types: hit._source.finding_types ?? null,
    remediationText: hit._source.remediationText ?? null,
    recommendationUrl: hit._source.recommendationUrl ?? null,
    rule_id: hit._source.rule_id ?? null,
    file: hit._source.file ?? null,
    line: hit._source.line ?? null,
    snippet: hit._source.snippet ?? null,
    shipsec: {
      workflow_id: hit._source.shipsec?.workflow_id ?? hit._source.workflow_id ?? '',
      workflow_name: hit._source.shipsec?.workflow_name ?? hit._source.workflow_name ?? '',
      run_id: hit._source.shipsec?.run_id ?? hit._source.run_id ?? '',
      component_id: hit._source.shipsec?.component_id ?? hit._source.component_id ?? '',
      trigger_source: hit._source.shipsec?.trigger_source ?? null,
    },
    '@timestamp': hit._source['@timestamp'] ?? '',
  };
}

/** Parse severity count buckets into a SeverityCounts object */
export function parseSeverityCounts(buckets: any[]): SeverityCounts {
  const counts = { ...INITIAL_SEVERITY_COUNTS };
  for (const bucket of buckets) {
    const key = bucket.key?.toLowerCase();
    if (key in counts) {
      counts[key as keyof SeverityCounts] = bucket.doc_count;
    }
  }
  return counts;
}
