#!/usr/bin/env bun
/**
 * Seed OpenSearch with sample security findings for development.
 *
 * Usage:
 *   bun run scripts/seed-opensearch-findings.ts
 *   bun run scripts/seed-opensearch-findings.ts --count 500
 *   bun run scripts/seed-opensearch-findings.ts --days 30
 *   bun run scripts/seed-opensearch-findings.ts --org-id <uuid>
 *   bun run scripts/seed-opensearch-findings.ts --clear  # delete all seeded indices first
 */

import { Client } from '@opensearch-project/opensearch';
import { randomUUID, createHash } from 'crypto';
import { parseArgs } from 'util';

// ── CLI args ─────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    count: { type: 'string', default: '200' },
    days: { type: 'string', default: '60' },
    'org-id': { type: 'string', default: '1883ee3c-5f80-4d5a-bc8e-52419fb36f1c' },
    clear: { type: 'boolean', default: false },
  },
});

const FINDING_COUNT = parseInt(args.count!, 10);
const DAYS_BACK = parseInt(args.days!, 10);
const ORG_ID = args['org-id']!;
const CLEAR = args.clear!;

// ── OpenSearch client ────────────────────────────────────────────────
const url = process.env.OPENSEARCH_URL || 'https://localhost:9200';
const username = process.env.OPENSEARCH_USERNAME || 'admin';
const password = process.env.OPENSEARCH_PASSWORD || 'admin';

const client = new Client({
  node: url,
  auth: { username, password },
  ssl: { rejectUnauthorized: false },
});

// ── Sample data pools ────────────────────────────────────────────────

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const SEVERITY_WEIGHTS = [0.05, 0.15, 0.40, 0.40]; // realistic distribution

const STATUSES = ['FAIL', 'PASS'] as const;
const STATUS_WEIGHTS = [0.35, 0.65];

type ScannerConfig = {
  scanner: string;
  checkNames: string[];
  services: string[];
  regions: string[];
  complianceFrameworks: string[];
  repositories: string[];
  ruleIds: string[];
  files: string[];
  extraFields: () => Record<string, unknown>;
};

const SCANNERS: ScannerConfig[] = [
  {
    scanner: 'prowler',
    checkNames: [
      'iam_no_root_access_key',
      'iam_password_policy_lowercase',
      's3_bucket_public_access',
      's3_bucket_logging_enabled',
      'ec2_security_group_default_restrict_traffic',
      'cloudtrail_multi_region_enabled',
      'rds_instance_storage_encrypted',
      'vpc_flow_logs_enabled',
      'kms_key_rotation_enabled',
      'guardduty_is_enabled',
      'iam_user_mfa_enabled',
      'ec2_ebs_volume_encryption',
    ],
    services: ['iam', 's3', 'ec2', 'rds', 'vpc', 'cloudtrail', 'kms', 'guardduty', 'lambda', 'ecs'],
    regions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'eu-central-1'],
    complianceFrameworks: ['CIS-AWS-1.5', 'SOC2', 'HIPAA', 'PCI-DSS', 'NIST-800-53'],
    repositories: [],
    ruleIds: [],
    files: [],
    extraFields: () => ({
      account_id: pick(['123456789012', '987654321098', '111222333444']),
      resource_arn: `arn:aws:${pick(['s3', 'ec2', 'iam', 'rds'])}:${pick(['us-east-1', 'us-west-2'])}:123456789012:${pick(['bucket/', 'instance/', 'user/', 'db:'])}${randomWord()}`,
      provider: 'aws',
    }),
  },
  {
    scanner: 'opengrep',
    checkNames: [
      'javascript.express.security.audit.xss.mustache-escape',
      'python.flask.security.injection.sql-injection',
      'javascript.lang.security.audit.path-traversal',
      'python.django.security.audit.xss.template-autoescape-off',
      'go.lang.security.audit.dangerous-exec-command',
      'typescript.react.security.audit.react-dangerouslysetinnerhtml',
      'java.spring.security.audit.insecure-deserialization',
      'ruby.rails.security.audit.mass-assignment',
    ],
    services: [],
    regions: [],
    complianceFrameworks: ['OWASP-Top-10', 'CWE-Top-25', 'SANS-Top-25'],
    repositories: ['acme/web-app', 'acme/api-server', 'acme/auth-service', 'acme/payment-service'],
    ruleIds: ['CWE-79', 'CWE-89', 'CWE-22', 'CWE-502', 'CWE-78', 'CWE-287', 'CWE-352'],
    files: [
      'src/controllers/auth.ts',
      'src/routes/api.py',
      'src/handlers/upload.go',
      'src/services/payment.java',
      'app/models/user.rb',
      'src/components/Dashboard.tsx',
      'src/utils/query.ts',
      'lib/parser.py',
    ],
    extraFields: () => ({
      file: pick([
        'src/controllers/auth.ts',
        'src/routes/api.py',
        'src/handlers/upload.go',
        'src/services/payment.java',
        'app/models/user.rb',
        'src/components/Dashboard.tsx',
      ]),
      line_number: Math.floor(Math.random() * 500) + 1,
      language: pick(['typescript', 'python', 'go', 'java', 'ruby', 'javascript']),
    }),
  },
  {
    scanner: 'trufflehog',
    checkNames: [
      'AWS',
      'GitHub',
      'Slack',
      'GenericAPIKey',
      'PrivateKey',
      'SendGrid',
      'Twilio',
      'Stripe',
      'GoogleOAuth',
      'JwtToken',
    ],
    services: [],
    regions: [],
    complianceFrameworks: ['SOC2', 'PCI-DSS'],
    repositories: ['acme/web-app', 'acme/infra', 'acme/api-server', 'acme/mobile-app'],
    ruleIds: [],
    files: [
      '.env',
      'config/secrets.yml',
      'src/config.ts',
      'deploy/terraform.tfvars',
      'docker-compose.yml',
      '.github/workflows/deploy.yml',
    ],
    extraFields: () => ({
      detector_type: pick(['AWS', 'GitHub', 'Slack', 'GenericAPIKey', 'PrivateKey', 'Stripe']),
      redacted: `****${randomHex(8)}`,
      verified: Math.random() > 0.6,
      file: pick(['.env', 'config/secrets.yml', 'src/config.ts', 'deploy/terraform.tfvars']),
    }),
  },
  {
    scanner: 'trivy',
    checkNames: [
      'CVE-2024-1234',
      'CVE-2023-44487',
      'CVE-2024-21626',
      'CVE-2023-45853',
      'CVE-2024-3094',
      'CVE-2023-38545',
      'CVE-2024-0567',
      'CVE-2023-50164',
      'GHSA-abc1-def2-ghi3',
    ],
    services: [],
    regions: [],
    complianceFrameworks: ['CIS-Docker-1.6', 'NIST-800-190'],
    repositories: ['acme/web-app', 'acme/api-server'],
    ruleIds: [],
    files: [],
    extraFields: () => ({
      package_name: pick(['openssl', 'curl', 'zlib', 'libxml2', 'nodejs', 'lodash', 'express', 'flask']),
      installed_version: `${Math.floor(Math.random() * 3)}.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 10)}`,
      fixed_version: `${Math.floor(Math.random() * 3 + 1)}.${Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 10)}`,
      image: pick(['node:18-alpine', 'python:3.11-slim', 'golang:1.21', 'ubuntu:22.04']),
      target: pick(['node:18-alpine', 'python:3.11-slim', 'golang:1.21']),
      vulnerability_id: `CVE-${2023 + Math.floor(Math.random() * 2)}-${Math.floor(Math.random() * 50000)}`,
    }),
  },
  {
    scanner: 'dependency',
    checkNames: [
      'outdated-dependency',
      'known-vulnerability',
      'license-risk',
      'unmaintained-package',
    ],
    services: [],
    regions: [],
    complianceFrameworks: ['OWASP-Dependency-Check'],
    repositories: ['acme/web-app', 'acme/api-server', 'acme/mobile-app'],
    ruleIds: [],
    files: ['package.json', 'requirements.txt', 'go.mod', 'Gemfile', 'pom.xml'],
    extraFields: () => ({
      package_name: pick(['lodash', 'axios', 'express', 'django', 'flask', 'requests', 'moment', 'underscore']),
      current_version: `${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 30)}.${Math.floor(Math.random() * 20)}`,
      latest_version: `${Math.floor(Math.random() * 5 + 3)}.${Math.floor(Math.random() * 10)}.0`,
      ecosystem: pick(['npm', 'pypi', 'go', 'rubygems', 'maven']),
    }),
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick<T>(items: readonly T[], weights: number[]): T {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += weights[i];
    if (r < sum) return items[i];
  }
  return items[items.length - 1];
}

function randomWord(): string {
  const words = ['alpha', 'beta', 'gamma', 'delta', 'prod', 'staging', 'dev', 'main', 'core', 'data', 'web', 'api'];
  return pick(words) + '-' + Math.floor(Math.random() * 1000);
}

function randomHex(len: number): string {
  return createHash('sha256').update(randomUUID()).digest('hex').slice(0, len);
}

function randomTimestamp(daysBack: number): Date {
  const now = Date.now();
  const start = now - daysBack * 86_400_000;
  return new Date(start + Math.random() * (now - start));
}

function generateFindingHash(...fields: string[]): string {
  const normalized = fields.map((f) => f.toLowerCase().trim()).join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ── Generate a single finding ────────────────────────────────────────

function generateFinding(workflowId: string, runId: string): Record<string, unknown> {
  const scannerConfig = pick(SCANNERS);
  const severity = weightedPick(SEVERITIES, SEVERITY_WEIGHTS);
  const status = weightedPick(STATUSES, STATUS_WEIGHTS);
  const checkName = pick(scannerConfig.checkNames);
  const timestamp = randomTimestamp(DAYS_BACK);

  const hashFields = [scannerConfig.scanner, checkName, randomHex(4)];
  const findingHash = generateFindingHash(...hashFields);

  const doc: Record<string, unknown> = {
    scanner: scannerConfig.scanner,
    severity,
    status,
    finding_hash: findingHash,
    check_name: checkName,
    description: `${checkName} — ${severity} severity finding detected by ${scannerConfig.scanner}`,
    '@timestamp': timestamp.toISOString(),
    ...scannerConfig.extraFields(),
  };

  // Add optional fields based on scanner
  if (scannerConfig.services.length > 0) {
    doc.service_name = pick(scannerConfig.services);
  }
  if (scannerConfig.regions.length > 0) {
    doc.region = pick(scannerConfig.regions);
  }
  if (scannerConfig.complianceFrameworks.length > 0) {
    // 1-3 frameworks per finding
    const count = Math.floor(Math.random() * 3) + 1;
    const frameworks = new Set<string>();
    for (let i = 0; i < count; i++) {
      frameworks.add(pick(scannerConfig.complianceFrameworks));
    }
    doc.compliance = Array.from(frameworks);
  }
  if (scannerConfig.repositories.length > 0) {
    doc.repository = pick(scannerConfig.repositories);
  }
  if (scannerConfig.ruleIds.length > 0) {
    doc.rule_id = pick(scannerConfig.ruleIds);
  }
  if (scannerConfig.files.length > 0 && !doc.file) {
    doc.file = pick(scannerConfig.files);
  }

  // Workflow context under shipsec namespace (matches indexer format)
  doc.shipsec = {
    organization_id: ORG_ID,
    run_id: runId,
    workflow_id: workflowId,
    workflow_name: `${scannerConfig.scanner}-scan`,
    component_id: 'core.analytics.sink',
    node_ref: 'analytics-sink-1',
    trigger_source: scannerConfig.repositories.length > 0 ? pick(scannerConfig.repositories) : undefined,
    trigger_type: pick(['manual', 'schedule', 'webhook']),
  };

  return doc;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 OpenSearch Findings Seeder`);
  console.log(`   URL:      ${url}`);
  console.log(`   Org ID:   ${ORG_ID}`);
  console.log(`   Count:    ${FINDING_COUNT}`);
  console.log(`   Days:     ${DAYS_BACK}`);
  console.log('');

  // Test connection
  try {
    const info = await client.info();
    console.log(`✓ Connected to OpenSearch ${(info.body as any).version?.number}\n`);
  } catch (err) {
    console.error('✗ Failed to connect to OpenSearch:', err);
    process.exit(1);
  }

  // Clear existing indices if requested
  if (CLEAR) {
    console.log('🗑  Clearing existing security-findings indices...');
    try {
      await client.indices.delete({ index: `security-findings-${ORG_ID.toLowerCase()}-*` });
      console.log('   Deleted existing indices\n');
    } catch {
      console.log('   No existing indices to delete\n');
    }
  }

  // Generate findings grouped by date (for date-sharded indices)
  const findingsByIndex = new Map<string, Record<string, unknown>[]>();

  // Simulate ~5-10 workflow runs
  const runCount = Math.max(5, Math.floor(FINDING_COUNT / 30));
  const runs: { workflowId: string; runId: string }[] = [];
  for (let i = 0; i < runCount; i++) {
    runs.push({ workflowId: randomUUID(), runId: randomUUID() });
  }

  for (let i = 0; i < FINDING_COUNT; i++) {
    const run = pick(runs);
    const finding = generateFinding(run.workflowId, run.runId);

    const ts = new Date(finding['@timestamp'] as string);
    const year = ts.getFullYear();
    const month = String(ts.getMonth() + 1).padStart(2, '0');
    const day = String(ts.getDate()).padStart(2, '0');
    const indexName = `security-findings-${ORG_ID.toLowerCase()}-${year}.${month}.${day}`;

    if (!findingsByIndex.has(indexName)) {
      findingsByIndex.set(indexName, []);
    }
    findingsByIndex.get(indexName)!.push(finding);
  }

  console.log(`📊 Generated ${FINDING_COUNT} findings across ${findingsByIndex.size} daily indices\n`);

  // Bulk index per-index
  let totalIndexed = 0;
  for (const [indexName, docs] of findingsByIndex) {
    const bulkOps: any[] = [];
    for (const doc of docs) {
      bulkOps.push({ index: { _index: indexName } });
      bulkOps.push(doc);
    }

    const response = await client.bulk({ body: bulkOps, refresh: 'wait_for' });

    if (response.body.errors) {
      const errorCount = response.body.items.filter((item: any) => item.index?.error).length;
      console.log(`   ⚠ ${indexName}: ${docs.length - errorCount}/${docs.length} indexed (${errorCount} errors)`);
    } else {
      console.log(`   ✓ ${indexName}: ${docs.length} documents`);
    }
    totalIndexed += docs.length;
  }

  // Verify
  const count = await client.count({ index: `security-findings-${ORG_ID.toLowerCase()}-*` });
  console.log(`\n✅ Done! Total documents in OpenSearch: ${(count.body as any).count}`);

  // Show scanner distribution
  const aggs = await client.search({
    index: `security-findings-${ORG_ID.toLowerCase()}-*`,
    body: {
      size: 0,
      aggs: {
        scanners: { terms: { field: 'scanner' } },
        severities: { terms: { field: 'severity' } },
      },
    },
  });

  const scannerBuckets = (aggs.body as any).aggregations?.scanners?.buckets ?? [];
  const sevBuckets = (aggs.body as any).aggregations?.severities?.buckets ?? [];

  console.log('\n📈 Scanner distribution:');
  for (const b of scannerBuckets) {
    console.log(`   ${b.key}: ${b.doc_count}`);
  }
  console.log('\n🔴 Severity distribution:');
  for (const b of sevBuckets) {
    console.log(`   ${b.key}: ${b.doc_count}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
