import { createClient } from '@clickhouse/client';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';

// Load environment variables
config();

// ─── Configuration ───────────────────────────────────────────────────────────

const ORG_ID = process.env.SEED_ORG_ID || 'stress-test';

interface TierConfig {
  findings: number;
}

const TIERS: Record<string, TierConfig> = {
  small: { findings: 500 },
  medium: { findings: 5_000 },
  large: { findings: 50_000 },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function pickWeighted(dist: [string, number][]): string {
  const r = Math.random();
  let cumulative = 0;
  for (const [value, weight] of dist) {
    cumulative += weight;
    if (r <= cumulative) return value;
  }
  return dist[dist.length - 1][0];
}

/**
 * Generate a date within `daysBack` of now, weighted toward recent dates.
 * Uses a quadratic bias: random^2 makes values cluster near 0 (= now).
 */
function recentWeightedDate(daysBack: number): Date {
  const bias = Math.pow(Math.random(), 2); // clusters near 0
  const msBack = bias * daysBack * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msBack);
}

function shortUUID(): string {
  return randomUUID().split('-')[0];
}

// ─── Scanner Definitions ─────────────────────────────────────────────────────

// Weighted distribution (must sum to ~1.0)
const SCANNER_DIST: [string, number][] = [
  ['prowler', 0.3],
  ['opengrep', 0.15],
  ['dependency', 0.12],
  ['trivy', 0.1],
  ['trufflehog', 0.08],
  ['trivy-container', 0.08],
  ['grype', 0.07],
  ['nuclei', 0.05],
  ['supabase-scanner', 0.05],
];

const SEVERITY_DIST: [string, number][] = [
  ['critical', 0.08],
  ['high', 0.22],
  ['medium', 0.4],
  ['low', 0.25],
  ['info', 0.05],
];

const STATUS_DIST: [string, number][] = [
  ['FAIL', 0.65],
  ['PASS', 0.2],
  ['MUTED', 0.1],
  ['MANUAL', 0.05],
];

// ─── Cloud Scanner Data ──────────────────────────────────────────────────────

const AWS_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'];

const AWS_ACCOUNTS = [
  { id: '123456789012', name: 'production' },
  { id: '234567890123', name: 'staging' },
  { id: '345678901234', name: 'development' },
];

const AWS_SERVICES = ['s3', 'ec2', 'iam', 'rds', 'lambda', 'cloudfront', 'kms', 'sns', 'sqs'];

// Prowler checks organized by service for logical consistency
const PROWLER_CHECKS: Record<string, { check: string; title: string; remediation: string }[]> = {
  iam: [
    {
      check: 'iam_root_mfa_enabled',
      title: 'Root account does not have MFA enabled',
      remediation: 'Enable MFA for the root account using a hardware or virtual MFA device.',
    },
    {
      check: 'iam_password_policy_uppercase',
      title: 'IAM password policy does not require uppercase letters',
      remediation: 'Update the IAM password policy to require at least one uppercase letter.',
    },
    {
      check: 'iam_user_console_access_unused',
      title: 'IAM user has console access but has not logged in for 90+ days',
      remediation: 'Disable console access for inactive IAM users or remove the user.',
    },
    {
      check: 'iam_policy_allows_full_admin',
      title: 'IAM policy grants full administrative access (*:*)',
      remediation:
        'Replace wildcard policies with least-privilege permissions specific to the workload.',
    },
    {
      check: 'iam_access_key_rotation',
      title: 'IAM access key has not been rotated in over 90 days',
      remediation: 'Rotate the access key and update applications to use the new key.',
    },
  ],
  s3: [
    {
      check: 's3_bucket_public_access',
      title: 'S3 bucket has public access enabled',
      remediation: 'Enable S3 Block Public Access settings on the bucket.',
    },
    {
      check: 's3_bucket_versioning_enabled',
      title: 'S3 bucket does not have versioning enabled',
      remediation: 'Enable versioning on the S3 bucket to protect against accidental deletion.',
    },
    {
      check: 's3_bucket_encryption_at_rest',
      title: 'S3 bucket does not have server-side encryption enabled',
      remediation: 'Enable default server-side encryption (SSE-S3 or SSE-KMS) on the bucket.',
    },
    {
      check: 's3_bucket_logging_enabled',
      title: 'S3 bucket access logging is not enabled',
      remediation: 'Enable server access logging to track requests for security auditing.',
    },
  ],
  ec2: [
    {
      check: 'ec2_security_group_open_to_world',
      title: 'Security group allows unrestricted ingress (0.0.0.0/0)',
      remediation:
        'Restrict security group rules to specific IP ranges required by your application.',
    },
    {
      check: 'ec2_instance_imdsv2_required',
      title: 'EC2 instance does not require IMDSv2',
      remediation: 'Configure the instance to require IMDSv2 to prevent SSRF token theft.',
    },
    {
      check: 'ec2_ebs_volume_encryption',
      title: 'EBS volume is not encrypted',
      remediation: 'Enable encryption on EBS volumes using AWS-managed or customer-managed keys.',
    },
  ],
  rds: [
    {
      check: 'rds_instance_public_access',
      title: 'RDS instance is publicly accessible',
      remediation: 'Modify the RDS instance to disable public accessibility.',
    },
    {
      check: 'rds_instance_encryption_enabled',
      title: 'RDS instance storage is not encrypted',
      remediation: 'Create an encrypted snapshot and restore to a new encrypted instance.',
    },
    {
      check: 'rds_instance_backup_enabled',
      title: 'RDS instance does not have automated backups enabled',
      remediation: 'Enable automated backups with an appropriate retention period (7+ days).',
    },
  ],
  lambda: [
    {
      check: 'lambda_function_public_access',
      title: 'Lambda function has a resource-based policy allowing public invoke',
      remediation: 'Update the resource-based policy to restrict access to specific principals.',
    },
    {
      check: 'lambda_function_runtime_deprecated',
      title: 'Lambda function uses a deprecated runtime',
      remediation: 'Update the function to use a supported runtime version.',
    },
  ],
  cloudfront: [
    {
      check: 'cloudfront_distribution_https_only',
      title: 'CloudFront distribution does not enforce HTTPS',
      remediation: 'Update the distribution to redirect HTTP to HTTPS or use HTTPS-only.',
    },
  ],
  kms: [
    {
      check: 'kms_key_rotation_enabled',
      title: 'KMS key does not have automatic rotation enabled',
      remediation: 'Enable automatic key rotation for symmetric KMS keys.',
    },
    {
      check: 'kms_key_not_scheduled_for_deletion',
      title: 'KMS key is scheduled for deletion',
      remediation: 'Cancel the key deletion and review if the key is still needed.',
    },
  ],
  sns: [
    {
      check: 'sns_topic_encryption_enabled',
      title: 'SNS topic does not have server-side encryption enabled',
      remediation: 'Enable SSE for the SNS topic using an AWS KMS key.',
    },
  ],
  sqs: [
    {
      check: 'sqs_queue_encryption_enabled',
      title: 'SQS queue does not have server-side encryption enabled',
      remediation: 'Enable SSE for the SQS queue using an AWS KMS key.',
    },
    {
      check: 'sqs_queue_public_access',
      title: 'SQS queue policy allows public access',
      remediation: 'Restrict the SQS queue policy to specific AWS accounts or IAM principals.',
    },
  ],
};

const COMPLIANCE_FRAMEWORKS = ['CIS', 'PCI-DSS', 'SOC2', 'HIPAA', 'NIST-800-53', 'ISO-27001'];

const FINDING_TYPES = [
  'Software and Configuration Checks',
  'TTPs',
  'Sensitive Data Identifications',
  'Effects',
  'Unusual Behaviors',
];

const RESOURCE_TAGS_POOL = {
  Environment: ['production', 'staging', 'development', 'sandbox'],
  Team: ['platform', 'backend', 'frontend', 'security', 'data', 'devops', 'sre'],
  Project: ['core-api', 'auth-service', 'data-pipeline', 'web-app', 'mobile-backend', 'analytics'],
  CostCenter: ['eng-100', 'eng-200', 'eng-300', 'ops-100', 'ops-200'],
  Owner: ['alice@company.com', 'bob@company.com', 'carol@company.com', 'dave@company.com'],
};

// ─── Code Scanner Data ───────────────────────────────────────────────────────

const CODE_FILES = [
  'src/api/auth.ts',
  'src/api/users.ts',
  'src/api/payments.ts',
  'src/middleware/cors.ts',
  'src/middleware/rate-limit.ts',
  'src/services/database.ts',
  'src/services/cache.ts',
  'src/services/email.ts',
  'src/utils/crypto.ts',
  'src/utils/validators.ts',
  'config/database.yml',
  'config/redis.yml',
  'config/nginx.conf',
  'docker-compose.yml',
  'Dockerfile',
  'scripts/deploy.sh',
  'scripts/backup.sh',
  'terraform/main.tf',
  'terraform/variables.tf',
  'terraform/iam.tf',
  'k8s/deployment.yaml',
  'k8s/service.yaml',
  'k8s/ingress.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
];

const OPENGREP_RULES: { rule: string; title: string; description: string }[] = [
  {
    rule: 'typescript.security.sql-injection',
    title: 'Potential SQL injection via string concatenation',
    description:
      'User-supplied data is concatenated into a SQL query string without parameterization, which could allow SQL injection.',
  },
  {
    rule: 'typescript.security.xss-reflected',
    title: 'Reflected cross-site scripting (XSS) in response',
    description:
      'User input is included directly in the HTTP response without escaping, enabling reflected XSS attacks.',
  },
  {
    rule: 'typescript.security.hardcoded-secret',
    title: 'Hardcoded secret or API key detected in source code',
    description:
      'A secret or API key appears to be hardcoded. Move it to environment variables or a secrets manager.',
  },
  {
    rule: 'typescript.security.insecure-random',
    title: 'Use of Math.random() for security-sensitive operation',
    description:
      'Math.random() is not cryptographically secure. Use crypto.randomBytes() or crypto.randomUUID() for tokens and secrets.',
  },
  {
    rule: 'typescript.security.path-traversal',
    title: 'Potential path traversal via unsanitized user input',
    description:
      'User input is used to construct a file path without sanitization, which could allow reading or writing arbitrary files.',
  },
  {
    rule: 'typescript.security.command-injection',
    title: 'OS command injection via unsanitized input',
    description:
      'User-supplied data is passed to a shell command without sanitization. Use parameterized exec or avoid shell execution.',
  },
  {
    rule: 'typescript.security.insecure-cookie',
    title: 'Cookie set without Secure or HttpOnly flag',
    description:
      'Session cookies should be set with Secure, HttpOnly, and SameSite attributes to prevent theft and CSRF.',
  },
  {
    rule: 'typescript.security.eval-usage',
    title: 'Dynamic code execution via eval()',
    description:
      'eval() executes arbitrary code and should be avoided. Use safer alternatives like JSON.parse() or a sandboxed interpreter.',
  },
  {
    rule: 'yaml.security.exposed-port',
    title: 'Container exposes sensitive port to host network',
    description:
      'A Docker container maps an internal port to the host, which could expose services unintentionally in production.',
  },
  {
    rule: 'terraform.security.iam-wildcard-action',
    title: 'IAM policy uses wildcard (*) action',
    description:
      'Using wildcard actions in IAM policies grants excessive permissions. Follow least-privilege principle.',
  },
];

const TRUFFLEHOG_SECRETS: { type: string; title: string; description: string }[] = [
  {
    type: 'AWS',
    title: 'AWS access key ID found in source code',
    description:
      'An AWS access key ID (AKIA...) was detected. Rotate the key immediately and use IAM roles or environment variables.',
  },
  {
    type: 'GitHub',
    title: 'GitHub personal access token detected',
    description:
      'A GitHub PAT (ghp_...) was found. Revoke the token and use fine-grained tokens with minimal scopes.',
  },
  {
    type: 'Slack',
    title: 'Slack webhook URL or bot token exposed',
    description:
      'A Slack token (xoxb-...) or webhook URL was detected. Regenerate the token from Slack admin settings.',
  },
  {
    type: 'Stripe',
    title: 'Stripe secret API key found',
    description:
      'A Stripe secret key (sk_live_...) was detected. Roll the key in the Stripe dashboard immediately.',
  },
  {
    type: 'SendGrid',
    title: 'SendGrid API key exposed in source',
    description:
      'A SendGrid API key (SG....) was found. Revoke and regenerate the key from the SendGrid console.',
  },
  {
    type: 'PrivateKey',
    title: 'RSA/EC private key detected in file',
    description:
      'A private key was found in the source tree. Remove it from version control and use a secrets manager.',
  },
  {
    type: 'Generic',
    title: 'High-entropy string resembling a secret or password',
    description:
      'A high-entropy string that may be a credential was detected. Verify and move to a secrets manager if confirmed.',
  },
  {
    type: 'JWT',
    title: 'JWT signing secret hardcoded in source',
    description:
      'A JWT secret or HMAC key is hardcoded. Move it to environment variables or a vault.',
  },
];

// ─── Dependency Scanner Data ─────────────────────────────────────────────────

const DEPENDENCY_PACKAGES: {
  name: string;
  version: string;
  fixedVersion: string;
  cve: string;
  title: string;
  description: string;
}[] = [
  {
    name: 'lodash',
    version: '4.17.20',
    fixedVersion: '4.17.21',
    cve: 'CVE-2021-23337',
    title: 'Prototype Pollution in lodash',
    description:
      'lodash before 4.17.21 is vulnerable to command injection via the template function.',
  },
  {
    name: 'express',
    version: '4.17.1',
    fixedVersion: '4.18.2',
    cve: 'CVE-2022-24999',
    title: 'Open redirect vulnerability in express',
    description:
      'Express.js before 4.18.2 allows open redirects when using untrusted URLs in res.redirect().',
  },
  {
    name: 'jsonwebtoken',
    version: '8.5.1',
    fixedVersion: '9.0.0',
    cve: 'CVE-2022-23529',
    title: 'Insecure default algorithm in jsonwebtoken',
    description:
      'jsonwebtoken before 9.0.0 allows algorithm confusion attacks when the secretOrPublicKey is not specified.',
  },
  {
    name: 'axios',
    version: '0.21.1',
    fixedVersion: '0.21.2',
    cve: 'CVE-2021-3749',
    title: 'Server-Side Request Forgery in axios',
    description:
      'axios before 0.21.2 is vulnerable to SSRF when following redirects to internal network addresses.',
  },
  {
    name: 'minimatch',
    version: '3.0.4',
    fixedVersion: '3.0.5',
    cve: 'CVE-2022-3517',
    title: 'ReDoS vulnerability in minimatch',
    description:
      'minimatch before 3.0.5 is vulnerable to Regular Expression Denial of Service via long brace patterns.',
  },
  {
    name: 'tar',
    version: '6.1.10',
    fixedVersion: '6.1.12',
    cve: 'CVE-2022-33987',
    title: 'Arbitrary file creation via symlink in tar',
    description:
      'tar before 6.1.12 allows arbitrary file creation outside the extraction directory via symbolic links.',
  },
  {
    name: 'node-fetch',
    version: '2.6.6',
    fixedVersion: '2.6.7',
    cve: 'CVE-2022-0235',
    title: 'Exposure of sensitive information in node-fetch',
    description:
      'node-fetch before 2.6.7 forwards authorization headers on cross-origin redirects.',
  },
  {
    name: 'glob-parent',
    version: '5.1.1',
    fixedVersion: '5.1.2',
    cve: 'CVE-2020-28469',
    title: 'ReDoS in glob-parent',
    description: 'glob-parent before 5.1.2 is vulnerable to Regular Expression Denial of Service.',
  },
  {
    name: 'xml2js',
    version: '0.4.23',
    fixedVersion: '0.5.0',
    cve: 'CVE-2023-0842',
    title: 'Prototype pollution in xml2js',
    description:
      'xml2js before 0.5.0 is vulnerable to prototype pollution when parsing specially crafted XML.',
  },
  {
    name: 'semver',
    version: '7.3.7',
    fixedVersion: '7.5.2',
    cve: 'CVE-2022-25883',
    title: 'ReDoS in semver range parsing',
    description:
      'semver before 7.5.2 is vulnerable to Regular Expression Denial of Service in range parsing.',
  },
  {
    name: 'tough-cookie',
    version: '4.1.2',
    fixedVersion: '4.1.3',
    cve: 'CVE-2023-26136',
    title: 'Prototype pollution in tough-cookie',
    description:
      'tough-cookie before 4.1.3 is vulnerable to prototype pollution via CookieJar.setCookie.',
  },
  {
    name: 'word-wrap',
    version: '1.2.3',
    fixedVersion: '1.2.4',
    cve: 'CVE-2023-26115',
    title: 'ReDoS in word-wrap',
    description: 'word-wrap before 1.2.4 is vulnerable to Regular Expression Denial of Service.',
  },
];

// ─── Container Scanner Data ──────────────────────────────────────────────────

const CONTAINER_IMAGES = [
  'nginx:1.21',
  'nginx:1.23-alpine',
  'node:18-alpine',
  'node:16-bullseye',
  'python:3.11-slim',
  'python:3.9-alpine',
  'postgres:14-alpine',
  'postgres:15',
  'redis:7-alpine',
  'mongo:6',
  'golang:1.21-alpine',
  'ubuntu:22.04',
  'debian:bullseye-slim',
  'alpine:3.18',
  'openjdk:17-slim',
];

const CONTAINER_VULNS: {
  pkg: string;
  version: string;
  fixedVersion: string;
  cve: string;
  title: string;
}[] = [
  {
    pkg: 'openssl',
    version: '3.0.8',
    fixedVersion: '3.0.10',
    cve: 'CVE-2023-2650',
    title: 'Excessive processing time in OpenSSL ASN.1 object identifier verification',
  },
  {
    pkg: 'libcurl',
    version: '7.88.0',
    fixedVersion: '8.1.0',
    cve: 'CVE-2023-27534',
    title: 'SFTP path resolving vulnerability in libcurl',
  },
  {
    pkg: 'zlib',
    version: '1.2.11',
    fixedVersion: '1.2.13',
    cve: 'CVE-2022-37434',
    title: 'Heap-based buffer over-read in zlib inflate',
  },
  {
    pkg: 'libexpat',
    version: '2.4.8',
    fixedVersion: '2.5.0',
    cve: 'CVE-2022-43680',
    title: 'Use-after-free in libexpat XML parser',
  },
  {
    pkg: 'glibc',
    version: '2.35',
    fixedVersion: '2.36',
    cve: 'CVE-2023-4911',
    title: 'Buffer overflow in glibc ld.so (Looney Tunables)',
  },
  {
    pkg: 'krb5-libs',
    version: '1.19.3',
    fixedVersion: '1.20.1',
    cve: 'CVE-2022-42898',
    title: 'Integer overflow in krb5 PAC parsing',
  },
  {
    pkg: 'busybox',
    version: '1.35.0',
    fixedVersion: '1.36.0',
    cve: 'CVE-2022-48174',
    title: 'Stack overflow vulnerability in busybox ash',
  },
  {
    pkg: 'libxml2',
    version: '2.9.14',
    fixedVersion: '2.10.3',
    cve: 'CVE-2023-28484',
    title: 'NULL pointer dereference in libxml2 xmlSchemaValidate',
  },
];

// ─── Nuclei Scanner Data ─────────────────────────────────────────────────────

const NUCLEI_TARGETS = [
  'https://api.example.com',
  'https://app.example.com',
  'https://admin.example.com',
  'https://staging.example.com',
  'https://dev.example.com',
  'http://10.0.1.50:8080',
  'http://10.0.2.100:3000',
  'http://internal-api.local:8443',
];

const NUCLEI_TEMPLATES: {
  templateId: string;
  title: string;
  description: string;
  tags: string[];
}[] = [
  {
    templateId: 'http-missing-security-headers',
    title: 'Missing security headers detected',
    description:
      'The HTTP response is missing critical security headers (X-Frame-Options, X-Content-Type-Options, CSP).',
    tags: ['misconfiguration', 'http', 'headers'],
  },
  {
    templateId: 'ssl-tls-version-detection',
    title: 'Deprecated TLS version in use (TLS 1.0/1.1)',
    description:
      'The server supports deprecated TLS versions that are vulnerable to known attacks (POODLE, BEAST).',
    tags: ['ssl', 'tls', 'misconfiguration'],
  },
  {
    templateId: 'exposed-admin-panel',
    title: 'Admin panel accessible without authentication',
    description:
      'An administrative interface is exposed to the network without proper authentication controls.',
    tags: ['exposure', 'admin', 'panel'],
  },
  {
    templateId: 'cors-misconfiguration',
    title: 'Permissive CORS policy allows any origin',
    description:
      'The server returns Access-Control-Allow-Origin: * which may allow unauthorized cross-origin data access.',
    tags: ['misconfiguration', 'cors'],
  },
  {
    templateId: 'directory-listing-enabled',
    title: 'Directory listing enabled on web server',
    description:
      'Web server returns directory listings that may reveal sensitive files and internal structure.',
    tags: ['exposure', 'directory', 'listing'],
  },
  {
    templateId: 'git-config-exposed',
    title: '.git/config file accessible via web',
    description:
      'The .git directory is accessible, potentially exposing source code, credentials, and commit history.',
    tags: ['exposure', 'git', 'config'],
  },
  {
    templateId: 'open-redirect',
    title: 'Open redirect vulnerability in URL parameter',
    description:
      'The application redirects users to a URL specified in a parameter without validation, enabling phishing attacks.',
    tags: ['vulnerability', 'redirect'],
  },
  {
    templateId: 'server-version-disclosure',
    title: 'Server software version disclosed in headers',
    description:
      'The Server header reveals specific software and version information that helps attackers target known vulnerabilities.',
    tags: ['exposure', 'server', 'version'],
  },
];

// ─── Supabase Scanner Data ───────────────────────────────────────────────────

const SUPABASE_CHECKS: {
  check: string;
  title: string;
  description: string;
  service: string;
}[] = [
  {
    check: 'supabase_rls_disabled',
    title: 'Row Level Security (RLS) is disabled on a public table',
    description:
      'A table exposed via the PostgREST API does not have Row Level Security enabled, allowing unrestricted data access.',
    service: 'database',
  },
  {
    check: 'supabase_anon_key_exposed',
    title: 'Supabase anon key used in client-side code with excessive permissions',
    description:
      'The anon key is used client-side but policies grant more access than intended for anonymous users.',
    service: 'auth',
  },
  {
    check: 'supabase_storage_public_bucket',
    title: 'Storage bucket allows public file uploads without authentication',
    description:
      'A Supabase storage bucket accepts file uploads from unauthenticated users, risking storage abuse.',
    service: 'storage',
  },
  {
    check: 'supabase_function_no_auth',
    title: 'Edge function invokable without authentication',
    description:
      'A Supabase Edge Function does not verify the JWT token, allowing unauthenticated invocations.',
    service: 'functions',
  },
  {
    check: 'supabase_mfa_not_enforced',
    title: 'Multi-factor authentication not enforced for admin users',
    description: 'Supabase project settings do not enforce MFA for users with elevated privileges.',
    service: 'auth',
  },
];

// ─── Finding Generator ───────────────────────────────────────────────────────

interface WorkflowRef {
  workflow_id: string;
  workflow_name: string;
  run_id: string;
}

function generateResourceTags(): Record<string, string> {
  const tags: Record<string, string> = {};
  // Always include Environment and Team
  tags['Environment'] = pick(RESOURCE_TAGS_POOL.Environment);
  tags['Team'] = pick(RESOURCE_TAGS_POOL.Team);
  // 60% chance of Project tag
  if (Math.random() < 0.6) tags['Project'] = pick(RESOURCE_TAGS_POOL.Project);
  // 40% chance of CostCenter
  if (Math.random() < 0.4) tags['CostCenter'] = pick(RESOURCE_TAGS_POOL.CostCenter);
  // 30% chance of Owner
  if (Math.random() < 0.3) tags['Owner'] = pick(RESOURCE_TAGS_POOL.Owner);
  return tags;
}

interface FindingRow {
  organization_id: string;
  run_id: string;
  workflow_id: string;
  workflow_name: string;
  component_id: string;
  node_ref: string;
  scanner: string;
  finding_hash: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  asset_key: string;
  region: string;
  account_id: string;
  service_name: string;
  check_name: string;
  compliance: string;
  resource_tags: string;
  finding_types: string;
  remediation_text: string;
  recommendation_url: string;
  timestamp: string;
}

function generateFinding(
  scanner: string,
  wfRef: WorkflowRef,
  findingHash: string,
  timestamp: Date,
): FindingRow {
  const severity = pickWeighted(SEVERITY_DIST);
  const status = pickWeighted(STATUS_DIST);

  const row: FindingRow = {
    organization_id: ORG_ID,
    run_id: wfRef.run_id,
    workflow_id: wfRef.workflow_id,
    workflow_name: wfRef.workflow_name,
    component_id: `security.${scanner}`,
    node_ref: `node_${shortUUID()}`,
    scanner,
    finding_hash: findingHash,
    severity,
    status,
    title: '',
    description: '',
    asset_key: '',
    region: '',
    account_id: '',
    service_name: '',
    check_name: '',
    compliance: '',
    resource_tags: '',
    finding_types: '',
    remediation_text: '',
    recommendation_url: '',
    timestamp: timestamp.toISOString().replace('T', ' ').replace('Z', ''),
  };

  switch (scanner) {
    case 'prowler':
    case 'supabase-scanner': {
      const account = pick(AWS_ACCOUNTS);
      const region = pick(AWS_REGIONS);

      if (scanner === 'prowler') {
        const service = pick(AWS_SERVICES);
        const checks = PROWLER_CHECKS[service] ?? PROWLER_CHECKS['iam'];
        const checkDef = pick(checks);

        row.region = region;
        row.account_id = account.id;
        row.service_name = service;
        row.check_name = checkDef.check;
        row.title = checkDef.title;
        row.description = `[${account.name}/${region}] ${checkDef.title}`;
        row.compliance = pickN(COMPLIANCE_FRAMEWORKS, randInt(1, 3)).join(',');
        row.resource_tags = JSON.stringify(generateResourceTags());
        row.finding_types = pickN(FINDING_TYPES, randInt(1, 2)).join(',');
        row.remediation_text = checkDef.remediation;
        row.recommendation_url = `https://docs.aws.amazon.com/securityhub/latest/userguide/${service}-checks.html`;
        row.asset_key = `arn:aws:${service}:${region}:${account.id}:${shortUUID()}`;
      } else {
        const checkDef = pick(SUPABASE_CHECKS);
        row.region = region;
        row.account_id = account.id;
        row.service_name = checkDef.service;
        row.check_name = checkDef.check;
        row.title = checkDef.title;
        row.description = checkDef.description;
        row.compliance = pickN(COMPLIANCE_FRAMEWORKS, randInt(1, 2)).join(',');
        row.resource_tags = JSON.stringify(generateResourceTags());
        row.finding_types = 'Software and Configuration Checks';
        row.remediation_text = checkDef.description;
        row.recommendation_url = 'https://supabase.com/docs/guides/platform/going-into-production';
        row.asset_key = `supabase://${checkDef.service}/${shortUUID()}`;
      }
      break;
    }

    case 'opengrep': {
      const rule = pick(OPENGREP_RULES);
      const file = pick(CODE_FILES);
      row.title = rule.title;
      row.description = rule.description;
      row.asset_key = file;
      row.check_name = rule.rule;
      row.remediation_text = `Fix the issue in ${file} by following the rule guidance.`;
      row.recommendation_url = `https://semgrep.dev/r/${rule.rule}`;
      break;
    }

    case 'trufflehog': {
      const secret = pick(TRUFFLEHOG_SECRETS);
      const file = pick(CODE_FILES);
      row.title = secret.title;
      row.description = secret.description;
      row.asset_key = file;
      row.check_name = `trufflehog.${secret.type.toLowerCase()}`;
      row.remediation_text = `Rotate the exposed ${secret.type} credential and remove it from source control.`;
      row.recommendation_url = 'https://trufflesecurity.com/docs/remediation';
      break;
    }

    case 'dependency':
    case 'trivy': {
      const dep = pick(DEPENDENCY_PACKAGES);
      row.title = `${dep.cve}: ${dep.title}`;
      row.description = dep.description;
      row.asset_key = `${dep.name}@${dep.version}`;
      row.check_name = dep.cve;
      row.remediation_text = `Upgrade ${dep.name} from ${dep.version} to ${dep.fixedVersion} or later.`;
      row.recommendation_url = `https://nvd.nist.gov/vuln/detail/${dep.cve}`;
      break;
    }

    case 'trivy-container':
    case 'grype': {
      const image = pick(CONTAINER_IMAGES);
      const vuln = pick(CONTAINER_VULNS);
      row.title = `${vuln.cve}: ${vuln.title}`;
      row.description = `${vuln.title} (${vuln.pkg} ${vuln.version} in ${image})`;
      row.asset_key = image;
      row.check_name = vuln.cve;
      row.remediation_text = `Update ${vuln.pkg} from ${vuln.version} to ${vuln.fixedVersion} in image ${image}.`;
      row.recommendation_url = `https://nvd.nist.gov/vuln/detail/${vuln.cve}`;
      break;
    }

    case 'nuclei': {
      const target = pick(NUCLEI_TARGETS);
      const template = pick(NUCLEI_TEMPLATES);
      row.title = template.title;
      row.description = template.description;
      row.asset_key = target;
      row.check_name = template.templateId;
      row.finding_types = template.tags.join(',');
      row.remediation_text = template.description;
      row.recommendation_url = `https://github.com/projectdiscovery/nuclei-templates/blob/main/${template.templateId}.yaml`;
      break;
    }
  }

  return row;
}

// ─── ClickHouse Bulk Insertion ────────────────────────────────────────────────

async function bulkInsert(
  chClient: ReturnType<typeof createClient>,
  rows: FindingRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  await chClient.insert({
    table: 'security_findings',
    values: rows,
    format: 'JSONEachRow',
  });

  return rows.length;
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function loadWorkflowRefs(pgPool: Pool): Promise<WorkflowRef[]> {
  const client = await pgPool.connect();
  try {
    const result = await client.query(
      `SELECT w.id AS workflow_id, w.name AS workflow_name, r.run_id
       FROM workflows w
       INNER JOIN workflow_runs r ON r.workflow_id = w.id
       WHERE w.organization_id = $1
       ORDER BY r.created_at DESC
       LIMIT 5000`,
      [ORG_ID],
    );

    if (result.rows.length === 0) {
      return [];
    }

    return result.rows.map((row) => ({
      workflow_id: row.workflow_id,
      workflow_name: row.workflow_name,
      run_id: row.run_id,
    }));
  } finally {
    client.release();
  }
}

async function cleanupFindings(chClient: ReturnType<typeof createClient>): Promise<void> {
  console.log(`\nDeleting existing findings for organization '${ORG_ID}'...`);
  await chClient.command({
    query: `ALTER TABLE security_findings DELETE WHERE organization_id = {orgId:String}`,
    query_params: { orgId: ORG_ID },
  });
  console.log('  Deleted successfully.');
}

async function seedFindings(
  chClient: ReturnType<typeof createClient>,
  wfRefs: WorkflowRef[],
  totalFindings: number,
): Promise<void> {
  const BATCH_SIZE = 500;

  // Generate unique finding hashes — roughly 1/3 of total count
  const uniqueHashCount = Math.max(50, Math.ceil(totalFindings / 3));
  const findingHashes: string[] = [];
  for (let i = 0; i < uniqueHashCount; i++) {
    findingHashes.push(randomUUID().replace(/-/g, '').slice(0, 16));
  }

  let totalIndexed = 0;
  let batch: FindingRow[] = [];

  for (let i = 0; i < totalFindings; i++) {
    const scanner = pickWeighted(SCANNER_DIST);
    const wfRef = pick(wfRefs);
    const hash = pick(findingHashes);
    const timestamp = recentWeightedDate(90);

    const row = generateFinding(scanner, wfRef, hash, timestamp);
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      const inserted = await bulkInsert(chClient, batch);
      totalIndexed += inserted;
      batch = [];

      if (totalIndexed % 2000 === 0 || totalIndexed === BATCH_SIZE) {
        console.log(`  ... inserted ${totalIndexed}/${totalFindings} findings`);
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    totalIndexed += await bulkInsert(chClient, batch);
  }

  console.log(`  Inserted ${totalIndexed}/${totalFindings} findings total`);
}

// ─── CLI & Main ──────────────────────────────────────────────────────────────

function parseArgs(): { tier: string; clean: boolean } {
  const args = process.argv.slice(2);
  let tier = 'small';
  let clean = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && args[i + 1]) {
      tier = args[i + 1];
      i++;
    }
    if (args[i] === '--clean') {
      clean = true;
    }
  }

  if (!clean && !TIERS[tier]) {
    console.error(`Invalid tier: ${tier}. Choose from: ${Object.keys(TIERS).join(', ')}`);
    process.exit(1);
  }

  return { tier, clean };
}

async function main() {
  const { tier, clean } = parseArgs();

  // ── ClickHouse connection (required) ──
  const chUrl = process.env.CLICKHOUSE_URL;
  if (!chUrl) {
    console.error('❌ CLICKHOUSE_URL environment variable is required');
    console.error('   Example: CLICKHOUSE_URL=http://localhost:8123');
    process.exit(1);
  }

  const chClient = createClient({
    url: chUrl,
    username: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  });

  // Test ClickHouse connection
  try {
    await chClient.ping();
    console.log('✅ Connected to ClickHouse');
  } catch (err) {
    console.error('❌ Failed to connect to ClickHouse:', err);
    process.exit(1);
  }

  // ── Cleanup mode ──
  if (clean) {
    await cleanupFindings(chClient);
    console.log('\nCleanup complete.');
    await chClient.close();
    return;
  }

  // ── Seed mode ──
  const tierConfig = TIERS[tier];

  console.log(`\nSecurity Findings Seed - Tier: ${tier.toUpperCase()}`);
  console.log(`Target: ${tierConfig.findings} findings`);
  console.log('='.repeat(50));

  // ── Postgres connection (to read parent seed data) ──
  const pgUrl = process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';
  const pgPool = new Pool({ connectionString: pgUrl });

  try {
    console.log('\nLoading workflow/run references from Postgres...');
    const wfRefs = await loadWorkflowRefs(pgPool);

    if (wfRefs.length === 0) {
      console.error(`\n❌ No workflows/runs found for organization '${ORG_ID}' in Postgres.`);
      console.error(
        '   Run the parent seed script first: bun backend/scripts/seed-stress-test.ts --tier small',
      );
      process.exit(1);
    }

    console.log(`  Found ${wfRefs.length} workflow/run references`);

    // Clean existing findings before re-seeding
    await cleanupFindings(chClient);

    const startTime = Date.now();

    console.log(`\nSeeding ${tierConfig.findings} security findings...`);
    await seedFindings(chClient, wfRefs, tierConfig.findings);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(50));
    console.log(`Seed complete in ${elapsed}s`);
    console.log(`Tier: ${tier} | Organization: ${ORG_ID}`);
    console.log('Run --clean to remove all seeded findings.');
  } finally {
    await pgPool.end();
    await chClient.close();
  }
}

main().catch((error) => {
  console.error('Script encountered an unexpected error');
  console.error(error);
  process.exit(1);
});
