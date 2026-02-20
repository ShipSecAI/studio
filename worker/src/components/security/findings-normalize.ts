import { z } from 'zod';
import { createHash } from 'crypto';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

const LOG_PREFIX = '[Findings Normalize]';

/**
 * Security Findings Normalizer Component
 *
 * Converts raw scanner output into standardized AnalyticsResult format.
 * Supports multiple scanner types: TruffleHog, OpenGrep, Dependency, Trivy.
 *
 * This enables:
 * - Unified PR comments with findings from multiple scanners
 * - Consistent OpenSearch indexing via Analytics Sink
 * - Filtering findings to only changed files in PRs
 * - Cross-scanner deduplication via finding_hash
 */

// Severity enum matching analytics schema
const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']);
type Severity = z.infer<typeof severitySchema>;

// Normalized output format compatible with Analytics Sink
const normalizedFindingSchema = z.object({
  scanner: z.string().describe('Scanner that produced this finding'),
  finding_hash: z.string().describe('Stable 16-char hash for deduplication'),
  severity: severitySchema.describe('Normalized severity level'),
  asset_key: z.string().optional().describe('Primary asset identifier (usually file path)'),
  // Common fields
  rule_id: z.string().describe('Rule or detector ID'),
  title: z.string().describe('Short title/summary of the finding'),
  description: z.string().optional().describe('Detailed description'),
  file: z.string().optional().describe('File path'),
  line: z.number().optional().describe('Line number'),
  snippet: z.string().optional().describe('Code snippet'),
  // Tool-specific fields preserved
  metadata: z.record(z.string(), z.unknown()).optional().describe('Tool-specific metadata'),
});

type NormalizedFinding = z.infer<typeof normalizedFindingSchema>;

// Summary output
const summarySchema = z.object({
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
  total: z.number(),
});

// Input: Raw findings from any scanner (accepts any JSON structure)
const inputSchema = inputs({
  rawFindings: port(z.array(z.record(z.string(), z.unknown())), {
    label: 'Raw Findings',
    description: 'Array of findings from a scanner component',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  changedFiles: port(z.array(z.string()).optional(), {
    label: 'Changed Files',
    description: 'Optional list of changed files (from github.pr.context) to filter findings',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
});

export type FindingsNormalizeInput = typeof inputSchema;

const outputSchema = outputs({
  findings: port(z.array(normalizedFindingSchema), {
    label: 'Normalized Findings',
    description: 'Findings in standardized format compatible with Analytics Sink',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  summary: port(summarySchema, {
    label: 'Summary',
    description: 'Count of findings by severity',
    connectionType: { kind: 'any' },
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of findings after filtering',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  filteredCount: port(z.number(), {
    label: 'Filtered Count',
    description: 'Number of findings filtered out (not in changed files)',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
});

export type FindingsNormalizeOutput = typeof outputSchema;

const parameterSchema = parameters({
  scannerType: param(
    z
      .enum([
        'trufflehog',
        'opengrep',
        'dependency',
        'trivy',
        'trivy-container',
        'nuclei',
        'prowler',
        'auto',
      ])
      .default('auto'),
    {
      label: 'Scanner Type',
      editor: 'select',
      options: [
        { label: 'Auto-detect', value: 'auto' },
        { label: 'TruffleHog (Secrets)', value: 'trufflehog' },
        { label: 'OpenGrep (SAST)', value: 'opengrep' },
        { label: 'Dependency Scanner', value: 'dependency' },
        { label: 'Trivy (Filesystem/Deps)', value: 'trivy' },
        { label: 'Trivy (Container Image)', value: 'trivy-container' },
        { label: 'Nuclei', value: 'nuclei' },
        { label: 'Prowler', value: 'prowler' },
      ],
      description: 'Type of scanner that produced the findings (auto-detect if unsure)',
    },
  ),
  filterToChangedFiles: param(z.boolean().default(true), {
    label: 'Filter to Changed Files',
    editor: 'boolean',
    description: 'Only include findings in files from changedFiles input (for PR scans)',
  }),
});

/**
 * Generate a stable hash for finding deduplication.
 * Uses SHA-256 truncated to 16 chars.
 */
function generateFindingHash(...fields: (string | number | undefined | null)[]): string {
  const normalized = fields.map((f) => (f == null ? '' : String(f).toLowerCase().trim())).join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Known workspace prefixes that scanners add to file paths.
 * Strip these before comparing against GitHub's relative paths.
 */
const WORKSPACE_PREFIXES = ['/workspace/repo/', '/scan/repo/', '/scan/', '/workspace/', '/repo/'];

export function stripWorkspacePrefix(filePath: string): string {
  for (const prefix of WORKSPACE_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
  }
  // Strip leading slash if present
  if (filePath.startsWith('/')) {
    return filePath.slice(1);
  }
  return filePath;
}

/**
 * Detect scanner type from finding structure
 */
function detectScannerType(finding: Record<string, unknown>): string {
  // TruffleHog: has type, secret_type, snippet
  if ('type' in finding && 'secret_type' in finding) {
    return 'trufflehog';
  }
  // OpenGrep: has rule_id, message, severity
  if ('rule_id' in finding && 'message' in finding) {
    return 'opengrep';
  }
  // Trivy: has VulnerabilityID or PkgName (camelCase — checked BEFORE dependency
  // to avoid misclassifying Trivy container findings as dependency findings)
  if ('VulnerabilityID' in finding || ('PkgName' in finding && 'Target' in finding)) {
    return 'trivy';
  }
  // Dependency: has package, vulnerability_id (lowercase keys)
  if ('package' in finding && ('vulnerability_id' in finding || 'vuln_id' in finding)) {
    return 'dependency';
  }
  // Nuclei: has template-id, matched-at
  if ('template-id' in finding || 'templateID' in finding) {
    return 'nuclei';
  }
  // Prowler: has check_id, status (raw ASFF format)
  if ('check_id' in finding && 'status' in finding) {
    return 'prowler';
  }
  // Prowler: NormalisedFinding format (accountId, serviceName, severity)
  if ('accountId' in finding && 'serviceName' in finding && 'severity' in finding) {
    return 'prowler';
  }
  return 'unknown';
}

/**
 * Normalize TruffleHog finding
 */
function normalizeTruffleHog(finding: Record<string, unknown>): NormalizedFinding {
  const type = String(finding.type || 'secret');
  const rawFile = String(finding.file || '');
  const file = stripWorkspacePrefix(rawFile);
  const line = Number(finding.line || 0);
  const secretType = String(finding.secret_type || type);
  const severity = (finding.severity as Severity) || 'high';
  const snippet = String(finding.snippet || '');
  const verified = finding.verified === true;

  return {
    scanner: 'trufflehog',
    finding_hash: generateFindingHash('trufflehog', type, rawFile, line, secretType),
    severity,
    asset_key: file,
    rule_id: secretType,
    title: `${secretType} secret${verified ? ' (verified)' : ''}`,
    description: `Detected ${secretType} secret in \`${file}\`${verified ? ' — **verified active**' : ''}`,
    file,
    line,
    snippet,
    metadata: {
      detectorType: type,
      secretType,
      verified,
    },
  };
}

/**
 * Normalize OpenGrep finding
 */
/**
 * Extract a human-readable title from an OpenGrep rule ID.
 * e.g. "python.flask.security.injection.sql-injection.tainted-sql" → "SQL Injection — Tainted SQL"
 * e.g. "generic.secrets.security.detected-stripe-api-key.detected-stripe-api-key" → "Detected Stripe API Key"
 */
function openGrepRuleTitle(ruleId: string): string {
  // Take the last segment (most specific), fall back to second-to-last if they're identical
  const parts = ruleId.split('.');
  let slug = parts[parts.length - 1] || ruleId;
  // If last two segments are identical (common pattern), use second-to-last
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    slug = parts[parts.length - 1];
  }
  // Common acronym map for proper capitalization
  const acronyms: Record<string, string> = {
    sql: 'SQL',
    api: 'API',
    xss: 'XSS',
    html: 'HTML',
    css: 'CSS',
    xml: 'XML',
    jwt: 'JWT',
    url: 'URL',
    http: 'HTTP',
    https: 'HTTPS',
    ssh: 'SSH',
    ssl: 'SSL',
    tls: 'TLS',
    rsa: 'RSA',
    aws: 'AWS',
    gcp: 'GCP',
    dns: 'DNS',
    ip: 'IP',
    os: 'OS',
    db: 'DB',
    iam: 'IAM',
    rce: 'RCE',
    ssrf: 'SSRF',
    csrf: 'CSRF',
    ldap: 'LDAP',
    oidc: 'OIDC',
    saml: 'SAML',
    cors: 'CORS',
    sast: 'SAST',
  };
  // Convert kebab-case to Title Case, then fix acronyms
  return slug
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b\w+\b/g, (word) => acronyms[word.toLowerCase()] || word);
}

function normalizeOpenGrep(finding: Record<string, unknown>): NormalizedFinding {
  const ruleId = String(finding.rule_id || 'unknown');
  const rawFile = String(finding.file || '');
  const file = stripWorkspacePrefix(rawFile);
  const line = Number(finding.line || 0);
  const message = String(finding.message || '');
  const severity = (finding.severity as Severity) || 'medium';
  const snippet = String(finding.snippet || '');

  return {
    scanner: 'opengrep',
    finding_hash: generateFindingHash('opengrep', ruleId, rawFile, line),
    severity,
    asset_key: file,
    rule_id: ruleId,
    title: openGrepRuleTitle(ruleId),
    description: message,
    file,
    line,
    snippet,
    metadata: {
      checkId: ruleId,
    },
  };
}

/**
 * Normalize Dependency finding
 */
function normalizeDependency(finding: Record<string, unknown>): NormalizedFinding {
  const pkg = String(finding.package || finding.Package || '');
  const version = String(finding.version || finding.Version || '');
  const vulnId = String(
    finding.vulnerability_id || finding.vuln_id || finding.VulnerabilityID || '',
  );
  const severity = mapDependencySeverity(String(finding.severity || finding.Severity || 'unknown'));
  const fixedVersion = String(finding.fixed_version || finding.FixedVersion || '');

  return {
    scanner: 'dependency',
    finding_hash: generateFindingHash('dependency', pkg, version, vulnId),
    severity,
    asset_key: `${pkg}@${version}`,
    rule_id: vulnId,
    title: `${vulnId} in ${pkg}`,
    description: `Vulnerable dependency: ${pkg}@${version}. ${fixedVersion ? `Fixed in: ${fixedVersion}` : 'No fix available'}`,
    metadata: {
      package: pkg,
      version,
      vulnerabilityId: vulnId,
      fixedVersion: fixedVersion || undefined,
    },
  };
}

/**
 * Normalize Trivy finding
 */
function normalizeTrivy(
  finding: Record<string, unknown>,
  forceContainer?: boolean,
): NormalizedFinding {
  const vulnId = String(finding.VulnerabilityID || finding.vulnerability_id || '');
  const pkgName = String(finding.PkgName || finding.package || '');
  const target = String(finding.Target || finding.target || '');
  const severity = mapTrivySeverity(String(finding.Severity || finding.severity || 'unknown'));
  const title = String(finding.Title || finding.title || vulnId);
  const description = String(finding.Description || finding.description || '');

  // Detect container image scans: trivy targets look like "nginx:1.21 (debian 11.2)"
  // while filesystem scans target file paths like "package-lock.json" or "Gemfile.lock"
  const trivyClass = String(finding.Class || finding.class || '');
  const isContainer =
    forceContainer ||
    trivyClass === 'os-pkgs' ||
    (target && target.includes('(') && target.includes(')'));

  return {
    scanner: isContainer ? 'trivy-container' : 'trivy',
    finding_hash: generateFindingHash(
      isContainer ? 'trivy-container' : 'trivy',
      target,
      pkgName,
      vulnId,
    ),
    severity,
    asset_key: target || pkgName,
    rule_id: vulnId,
    title,
    description,
    file: target,
    metadata: {
      vulnerabilityId: vulnId,
      packageName: pkgName,
      target,
    },
  };
}

/**
 * Normalize Nuclei finding
 */
function normalizeNuclei(finding: Record<string, unknown>): NormalizedFinding {
  const templateId = String(finding['template-id'] || finding.templateID || '');
  const matchedAt = String(finding['matched-at'] || finding.matchedAt || '');
  const info = (finding.info as any) || {};
  const severity = mapNucleiSeverity(String(finding.severity || info.severity || 'unknown'));
  const name = String(info.name || finding.name || templateId);
  const host = String(finding.host || '');

  return {
    scanner: 'nuclei',
    finding_hash: generateFindingHash('nuclei', templateId, host, matchedAt),
    severity,
    asset_key: host || matchedAt,
    rule_id: templateId,
    title: name,
    description: `Template: ${templateId} matched at ${matchedAt}`,
    metadata: {
      templateId,
      matchedAt,
      host,
      tags: info.tags,
    },
  };
}

/**
 * Normalize Prowler finding
 */
function normalizeProwler(finding: Record<string, unknown>): NormalizedFinding {
  // Handle both raw ASFF (check_id) and NormalisedFinding (id) field names
  const checkId = String(finding.check_id || finding.id || '');
  const status = String(finding.status || '');
  const severity = mapProwlerSeverity(String(finding.severity || 'medium'));
  const resource = String(finding.resource || finding.resource_id || finding.resourceId || '');
  const checkTitle = String(finding.check_title || finding.title || checkId);
  const statusExtended = String(finding.status_extended || finding.description || '');

  return {
    scanner: 'prowler',
    finding_hash: generateFindingHash('prowler', checkId, resource),
    severity,
    asset_key: resource,
    rule_id: checkId,
    title: checkTitle,
    description: statusExtended,
    metadata: {
      checkId,
      status,
      resource,
      region: finding.region,
      service: finding.service,
    },
  };
}

// Severity mapping helpers
function mapDependencySeverity(severity: string): Severity {
  const upper = severity.toUpperCase();
  if (upper === 'CRITICAL') return 'critical';
  if (upper === 'HIGH') return 'high';
  if (upper === 'MEDIUM' || upper === 'MODERATE') return 'medium';
  if (upper === 'LOW') return 'low';
  return 'info';
}

function mapTrivySeverity(severity: string): Severity {
  const upper = severity.toUpperCase();
  if (upper === 'CRITICAL') return 'critical';
  if (upper === 'HIGH') return 'high';
  if (upper === 'MEDIUM') return 'medium';
  if (upper === 'LOW') return 'low';
  return 'info';
}

function mapNucleiSeverity(severity: string): Severity {
  const lower = severity.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'medium') return 'medium';
  if (lower === 'low') return 'low';
  return 'info';
}

function mapProwlerSeverity(severity: string): Severity {
  const lower = severity.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'medium') return 'medium';
  if (lower === 'low') return 'low';
  return 'info';
}

const definition = defineComponent({
  id: 'security.findings.normalize',
  label: 'Normalize Security Findings',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Convert scanner output to standardized format. Enables unified PR comments, Analytics Sink indexing, and filtering to changed files.',
  ui: {
    slug: 'security-findings-normalize',
    version: '1.0.0',
    type: 'output',
    category: 'security',
    description: 'Normalize findings from multiple scanners into a unified format.',
    documentation:
      'Connect this component after any scanner (TruffleHog, OpenGrep, etc.) to convert findings to a standard format. The normalized output can be used with Analytics Sink for OpenSearch indexing or with findings formatters for PR comments.',
    icon: 'Filter',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'Connect TruffleHog findings → Normalize → Analytics Sink for dashboards',
    examples: [
      'Normalize TruffleHog findings before posting PR comment',
      'Filter OpenGrep findings to only changed files in PR',
      'Combine multiple scanner outputs for unified reporting',
    ],
  },
  async execute({ inputs, params }, context) {
    const { rawFindings, changedFiles } = inputSchema.parse(inputs);
    const { scannerType, filterToChangedFiles } = parameterSchema.parse(params);

    context.logger.info(`${LOG_PREFIX} Normalizing ${rawFindings.length} findings`);

    if (rawFindings.length === 0) {
      context.emitProgress({
        message: 'No findings to normalize',
        level: 'info',
        data: { stage: 'complete' },
      });

      return outputSchema.parse({
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
        findingCount: 0,
        filteredCount: 0,
      });
    }

    context.emitProgress({
      message: `Normalizing ${rawFindings.length} findings...`,
      level: 'info',
      data: { count: rawFindings.length, stage: 'start' },
    });

    // Normalize each finding
    const normalizedFindings: NormalizedFinding[] = [];

    for (const finding of rawFindings) {
      const detectedType = scannerType === 'auto' ? detectScannerType(finding) : scannerType;

      let normalized: NormalizedFinding;

      switch (detectedType) {
        case 'trufflehog':
          normalized = normalizeTruffleHog(finding);
          break;
        case 'opengrep':
          normalized = normalizeOpenGrep(finding);
          break;
        case 'dependency':
          normalized = normalizeDependency(finding);
          break;
        case 'trivy':
          normalized = normalizeTrivy(finding);
          break;
        case 'trivy-container':
          normalized = normalizeTrivy(finding, true);
          break;
        case 'nuclei':
          normalized = normalizeNuclei(finding);
          break;
        case 'prowler':
          normalized = normalizeProwler(finding);
          break;
        default:
          // Generic fallback - preserve as-is with basic normalization
          normalized = {
            scanner: 'unknown',
            finding_hash: generateFindingHash('unknown', JSON.stringify(finding).slice(0, 100)),
            severity: 'info',
            rule_id: String(finding.id || finding.rule_id || 'unknown'),
            title: String(finding.title || finding.message || 'Unknown finding'),
            description: String(finding.description || ''),
            file: stripWorkspacePrefix(String(finding.file || finding.path || '')),
            line: Number(finding.line || 0),
            metadata: finding,
          };
      }

      normalizedFindings.push(normalized);
    }

    // Filter to changed files if requested
    let filteredFindings = normalizedFindings;
    let filteredCount = 0;

    if (filterToChangedFiles && changedFiles && changedFiles.length > 0) {
      // Build a set of normalized changed file paths (strip workspace prefixes)
      const changedSet = new Set<string>();
      for (const f of changedFiles) {
        changedSet.add(stripWorkspacePrefix(f));
      }

      filteredFindings = normalizedFindings.filter((f) => {
        if (!f.file) return true; // Keep findings without file info (e.g. dependency findings)
        const normalizedPath = stripWorkspacePrefix(f.file);
        return changedSet.has(normalizedPath);
      });

      filteredCount = normalizedFindings.length - filteredFindings.length;

      if (filteredCount > 0) {
        context.logger.info(
          `${LOG_PREFIX} Filtered ${filteredCount} findings (not in ${changedFiles.length} changed files)`,
        );
      }
    }

    // Build summary
    const summary = {
      critical: filteredFindings.filter((f) => f.severity === 'critical').length,
      high: filteredFindings.filter((f) => f.severity === 'high').length,
      medium: filteredFindings.filter((f) => f.severity === 'medium').length,
      low: filteredFindings.filter((f) => f.severity === 'low').length,
      info: filteredFindings.filter((f) => f.severity === 'info' || f.severity === 'none').length,
      total: filteredFindings.length,
    };

    context.logger.info(
      `${LOG_PREFIX} Normalized ${filteredFindings.length} findings (${summary.critical} critical, ${summary.high} high)`,
    );

    context.emitProgress({
      message: `✓ Normalized ${filteredFindings.length} findings`,
      level: 'info',
      data: { summary, filteredCount, stage: 'complete' },
    });

    return outputSchema.parse({
      findings: filteredFindings,
      summary,
      findingCount: filteredFindings.length,
      filteredCount,
    });
  },
});

componentRegistry.register(definition);
