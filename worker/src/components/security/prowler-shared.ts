/**
 * Shared types, schemas, and utility functions for the Prowler scan component.
 * Extracted to allow reuse across single-account and org-wide scan modes.
 */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { resolveDockerPath } from '@shipsec/component-sdk';
import type { IsolatedVolume } from '../../utils/isolated-volume';

// ---------------------------------------------------------------------------
// Severity & Status enums
// ---------------------------------------------------------------------------

export const severityLevels = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
  'unknown',
] as const;
export type NormalisedSeverity = (typeof severityLevels)[number];

export const statusLevels = [
  'FAILED',
  'PASSED',
  'WARNING',
  'NOT_APPLICABLE',
  'NOT_AVAILABLE',
  'UNKNOWN',
] as const;
export type NormalisedStatus = (typeof statusLevels)[number];

// ---------------------------------------------------------------------------
// Recommended flags
// ---------------------------------------------------------------------------

export const recommendedFlagOptions = [
  {
    id: 'quick',
    label: 'Quick scan',
    description: 'Reserved for older Prowler versions; current images do not apply an extra flag.',
    args: [],
    defaultSelected: false,
  },
  {
    id: 'severity-high-critical',
    label: 'Severity filter: high+critical (--severity high critical)',
    description: 'Limit findings to high and critical severities.',
    args: ['--severity', 'high', 'critical'],
    defaultSelected: false,
  },
  {
    id: 'ignore-exit-code',
    label: 'Do not fail on findings (--ignore-exit-code-3)',
    description: 'Treat exit code 3 (findings present) as success so flows do not fail.',
    args: ['--ignore-exit-code-3'],
    defaultSelected: true,
  },
  {
    id: 'no-banner',
    label: 'Hide banner (--no-banner)',
    description: 'Remove the ASCII banner from stdout for cleaner logs.',
    args: ['--no-banner'],
    defaultSelected: true,
  },
] as const;

export type RecommendedFlagId = (typeof recommendedFlagOptions)[number]['id'];

export const defaultSelectedFlagIds: RecommendedFlagId[] = recommendedFlagOptions
  .filter((option) => option.defaultSelected)
  .map((option) => option.id);

export const recommendedFlagIdSchema = z.enum(
  recommendedFlagOptions.map((option) => option.id) as [RecommendedFlagId, ...RecommendedFlagId[]],
);

export const recommendedFlagMap = new Map<RecommendedFlagId, string[]>(
  recommendedFlagOptions.map((option) => [option.id, [...option.args]]),
);

// ---------------------------------------------------------------------------
// Prowler finding schemas
// ---------------------------------------------------------------------------

export const prowlerFindingSchema = z
  .object({
    Id: z.string().optional(),
    Title: z.string().optional(),
    Description: z.string().optional(),
    AwsAccountId: z.string().optional(),
    Severity: z
      .object({
        Label: z.string().optional(),
        Original: z.string().optional(),
        Normalized: z.number().optional(),
      })
      .partial()
      .optional(),
    Compliance: z
      .object({
        Status: z.string().optional(),
        RelatedRequirements: z.array(z.string()).optional(),
        SecurityControlId: z.string().optional(),
        AssociatedStandards: z
          .array(
            z
              .object({
                StandardsId: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    ProductFields: z.record(z.string(), z.unknown()).optional(),
    GeneratorId: z.string().optional(),
    Resources: z
      .array(
        z
          .object({
            Id: z.string().optional(),
            Type: z.string().optional(),
            Region: z.string().optional(),
            Tags: z.record(z.string(), z.string()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    Remediation: z
      .object({
        Recommendation: z
          .object({
            Text: z.string().optional(),
            Url: z.string().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type ProwlerFinding = z.infer<typeof prowlerFindingSchema>;

const prowlerOcsfFindingSchema = z
  .object({
    message: z.string().optional(),
    metadata: z
      .object({
        event_code: z.string().optional(),
      })
      .passthrough()
      .optional(),
    finding_info: z
      .object({
        uid: z.string().optional(),
        title: z.string().optional(),
        desc: z.string().optional(),
      })
      .passthrough()
      .optional(),
    cloud: z
      .object({
        account: z
          .object({
            uid: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        region: z.string().optional(),
        provider: z.string().optional(),
      })
      .passthrough()
      .optional(),
    resources: z
      .array(
        z
          .object({
            uid: z.string().optional(),
            name: z.string().optional(),
            type: z.string().optional(),
            region: z.string().optional(),
            group: z
              .object({
                name: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    remediation: z
      .object({
        desc: z.string().optional(),
        references: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    severity: z.string().optional(),
    severity_id: z.number().optional(),
    status: z.string().optional(),
    status_code: z.string().optional(),
    status_detail: z.string().optional(),
    risk_details: z.string().optional(),
  })
  .passthrough();

type ProwlerOcsfFinding = z.infer<typeof prowlerOcsfFindingSchema>;

export const normalisedFindingSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  accountId: z.string().nullable(),
  resourceId: z.string().nullable(),
  region: z.string().nullable(),
  serviceName: z.string().nullable(),
  severity: z.enum(severityLevels),
  status: z.enum(statusLevels),
  description: z.string().nullable(),
  remediationText: z.string().nullable(),
  recommendationUrl: z.string().nullable(),
  checkId: z.string().nullable(),
  checkName: z.string().nullable(),
  ruleId: z.string().nullable(),
  provider: z.string().nullable(),
  resourceType: z.string().nullable(),
  compliance: z.array(z.string()),
  resourceTags: z.record(z.string(), z.string()),
  rawFinding: z.unknown(),
});

export type NormalisedFinding = z.infer<typeof normalisedFindingSchema>;

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function normaliseFindings(
  rawSegments: string[],
  runId: string,
): {
  findings: NormalisedFinding[];
  errors: string[];
} {
  const findings: NormalisedFinding[] = [];
  const errors: string[] = [];

  rawSegments.forEach((segment, segmentIndex) => {
    const candidates = parseSegment(segment, segmentIndex, errors);
    candidates.forEach((candidate, candidateIndex) => {
      const parsed = prowlerFindingSchema.safeParse(candidate);
      if (parsed.success && isProwlerAsffFinding(parsed.data)) {
        findings.push(toNormalisedFinding(parsed.data, findings.length, runId));
        return;
      }

      const ocsfParsed = prowlerOcsfFindingSchema.safeParse(candidate);
      if (ocsfParsed.success && isProwlerOcsfFinding(ocsfParsed.data)) {
        findings.push(toNormalisedOcsfFinding(ocsfParsed.data, findings.length, runId));
        return;
      }

      if (!parsed.success) {
        errors.push(
          `Segment ${segmentIndex + 1} item ${candidateIndex + 1}: ${parsed.error.message}`,
        );
      }
    });
  });

  return { findings, errors };
}

export function parseSegment(segment: string, segmentIndex: number, errors: string[]): unknown[] {
  const trimmed = (segment ?? '').trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.Findings)) {
        return record.Findings;
      }
      if (Array.isArray(record.findings)) {
        return record.findings;
      }
      return [parsed];
    }
  } catch (_error) {
    const ndjsonResults: unknown[] = [];
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line, lineIndex) => {
        try {
          ndjsonResults.push(JSON.parse(line));
        } catch (innerError) {
          errors.push(
            `Segment ${segmentIndex + 1} line ${lineIndex + 1}: Unable to parse JSON (${(innerError as Error).message})`,
          );
        }
      });

    if (ndjsonResults.length > 0) {
      return ndjsonResults;
    }

    errors.push(`Segment ${segmentIndex + 1}: Unable to parse Prowler output as JSON.`);
  }

  return [];
}

export function toNormalisedFinding(
  finding: ProwlerFinding,
  index: number,
  runId: string,
): NormalisedFinding {
  const primaryResource =
    Array.isArray(finding.Resources) && finding.Resources.length > 0
      ? finding.Resources[0]
      : undefined;
  const accountId = finding.AwsAccountId ?? extractAccountId(primaryResource?.Id) ?? null;
  const region = primaryResource?.Region ?? extractRegionFromArn(primaryResource?.Id) ?? null;
  const resourceId = primaryResource?.Id ?? null;
  const serviceName = extractServiceName(primaryResource?.Type, primaryResource?.Id);
  const severity = normaliseSeverity(finding);
  const status = normaliseStatus(finding.Compliance?.Status);
  const remediationText = finding.Remediation?.Recommendation?.Text ?? null;
  const recommendationUrl = finding.Remediation?.Recommendation?.Url ?? null;
  const productFields = finding.ProductFields ?? {};
  const checkId =
    getStringField(productFields, [
      'ProwlerCheckID',
      'ProwlerCheckId',
      'CheckId',
      'CheckID',
      'check_id',
    ]) ?? extractCheckIdFromProwlerId(finding.Id);
  const checkName =
    getStringField(productFields, ['ProwlerCheckTitle', 'CheckTitle', 'check_name']) ??
    finding.Title ??
    null;
  const compliance = collectComplianceTags(
    finding.Compliance,
    pickProductFieldValues(productFields, [
      'ProwlerComplianceFramework',
      'ProwlerComplianceFrameworks',
      'ProwlerComplianceRequirement',
      'ProwlerComplianceRequirements',
      'ProwlerComplianceControl',
      'ProwlerComplianceControls',
      'Compliance',
      'Standards',
      'RelatedRequirements',
    ]),
  );

  return {
    id: finding.Id ?? `${runId}-finding-${index + 1}`,
    title: finding.Title ?? null,
    accountId,
    resourceId,
    region,
    serviceName,
    severity,
    status,
    description: finding.Description ?? null,
    remediationText,
    recommendationUrl,
    checkId,
    checkName,
    ruleId: finding.GeneratorId ?? checkId,
    provider: 'aws',
    resourceType: primaryResource?.Type ?? null,
    compliance,
    resourceTags: normalizeStringMap(primaryResource?.Tags),
    rawFinding: finding,
  };
}

function isProwlerAsffFinding(finding: ProwlerFinding): boolean {
  return (
    finding.Id != null ||
    finding.Title != null ||
    finding.AwsAccountId != null ||
    finding.Severity != null ||
    finding.Compliance != null ||
    finding.Resources != null
  );
}

function isProwlerOcsfFinding(finding: ProwlerOcsfFinding): boolean {
  return (
    finding.metadata?.event_code != null ||
    finding.finding_info?.uid != null ||
    finding.cloud?.provider === 'gcp'
  );
}

function toNormalisedOcsfFinding(
  finding: ProwlerOcsfFinding,
  index: number,
  runId: string,
): NormalisedFinding {
  const primaryResource =
    Array.isArray(finding.resources) && finding.resources.length > 0
      ? finding.resources[0]
      : undefined;
  const remediationUrl = Array.isArray(finding.remediation?.references)
    ? finding.remediation.references.find((reference) => reference.trim().length > 0)
    : undefined;

  return {
    id:
      finding.finding_info?.uid ?? finding.metadata?.event_code ?? `${runId}-finding-${index + 1}`,
    title: finding.finding_info?.title ?? finding.message ?? null,
    accountId: finding.cloud?.account?.uid ?? null,
    resourceId: primaryResource?.uid ?? primaryResource?.name ?? null,
    region: primaryResource?.region ?? finding.cloud?.region ?? null,
    serviceName: primaryResource?.group?.name ?? extractServiceName(primaryResource?.type),
    severity: normaliseOcsfSeverity(finding.severity, finding.severity_id),
    status: normaliseStatus(finding.status_code ?? finding.status),
    description:
      finding.finding_info?.desc ?? finding.risk_details ?? finding.status_detail ?? null,
    remediationText: finding.remediation?.desc ?? null,
    recommendationUrl: remediationUrl ?? null,
    checkId: finding.metadata?.event_code ?? finding.finding_info?.uid ?? null,
    checkName: finding.finding_info?.title ?? finding.message ?? null,
    ruleId: finding.metadata?.event_code ?? finding.finding_info?.uid ?? null,
    provider: finding.cloud?.provider ?? null,
    resourceType: primaryResource?.type ?? null,
    compliance: collectComplianceTags(
      getUnknownField(finding, 'compliance'),
      getUnknownField(finding.metadata, 'profiles'),
      getUnknownField(finding.metadata, 'profile'),
      getUnknownField(finding.metadata, 'standards'),
      getUnknownField(finding.metadata, 'standard'),
    ),
    resourceTags: normalizeStringMap(
      getUnknownField(primaryResource, 'labels') ?? getUnknownField(primaryResource, 'tags'),
    ),
    rawFinding: finding,
  };
}

function getUnknownField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function pickProductFieldValues(record: Record<string, unknown>, keys: string[]): unknown[] {
  return keys.map((key) => record[key]).filter((value) => value != null);
}

function extractCheckIdFromProwlerId(id?: string): string | null {
  if (!id) return null;
  const match = id.match(/prowler-[^-]+-([A-Za-z0-9_]+)-/);
  return match?.[1] ?? null;
}

function collectComplianceTags(...values: unknown[]): string[] {
  const tags = new Set<string>();
  const visit = (value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string') {
      for (const part of value.split(/[,\n;]/)) {
        const trimmed = part.trim();
        if (
          trimmed.length > 0 &&
          trimmed.toUpperCase() !== 'PASSED' &&
          trimmed.toUpperCase() !== 'FAILED'
        ) {
          tags.add(trimmed);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of [
        'RelatedRequirements',
        'AssociatedStandards',
        'SecurityControlId',
        'StandardsId',
        'ProwlerComplianceFramework',
        'ProwlerComplianceRequirement',
        'ProwlerComplianceControl',
        'id',
        'uid',
        'name',
      ]) {
        visit(record[key]);
      }
    }
  };
  values.forEach(visit);
  return Array.from(tags).sort();
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      normalized[key] = String(raw);
    }
  }
  return normalized;
}

function normaliseOcsfSeverity(severity?: string, severityId?: number): NormalisedSeverity {
  if (typeof severity === 'string' && severity.trim().length > 0) {
    const lowered = severity.trim().toLowerCase();
    if (lowered.startsWith('crit')) return 'critical';
    if (lowered.startsWith('high')) return 'high';
    if (lowered.startsWith('med')) return 'medium';
    if (lowered.startsWith('low')) return 'low';
    if (lowered.startsWith('info')) return 'informational';
  }

  if (typeof severityId === 'number' && Number.isFinite(severityId)) {
    if (severityId >= 5) return 'critical';
    if (severityId === 4) return 'high';
    if (severityId === 3) return 'medium';
    if (severityId === 2) return 'low';
    if (severityId === 1) return 'informational';
  }

  return 'unknown';
}

export function normaliseSeverity(finding: ProwlerFinding): NormalisedSeverity {
  const label = finding.Severity?.Label ?? finding.Severity?.Original ?? '';

  if (typeof label === 'string' && label.trim().length > 0) {
    const lowered = label.trim().toLowerCase();
    if (lowered.startsWith('crit')) return 'critical';
    if (lowered.startsWith('high')) return 'high';
    if (lowered.startsWith('med')) return 'medium';
    if (lowered.startsWith('low')) return 'low';
    if (lowered.startsWith('info')) return 'informational';
  }

  const normalisedScore = finding.Severity?.Normalized;
  if (typeof normalisedScore === 'number' && Number.isFinite(normalisedScore)) {
    if (normalisedScore >= 90) return 'critical';
    if (normalisedScore >= 70) return 'high';
    if (normalisedScore >= 40) return 'medium';
    if (normalisedScore >= 1) return 'low';
    return 'informational';
  }

  return 'unknown';
}

export function normaliseStatus(status?: string): NormalisedStatus {
  if (!status || status.trim().length === 0) {
    return 'UNKNOWN';
  }
  const upper = status.trim().toUpperCase();
  if (upper.includes('FAIL')) return 'FAILED';
  if (upper.includes('PASS')) return 'PASSED';
  if (upper.includes('WARN')) return 'WARNING';
  if (upper.includes('NOT_APPLICABLE') || upper === 'NOTAPPLICABLE') return 'NOT_APPLICABLE';
  if (upper.includes('NOT_AVAILABLE') || upper === 'NOTAVAILABLE') return 'NOT_AVAILABLE';
  return 'UNKNOWN';
}

/**
 * Extract a human-readable service name from a Prowler ASFF resource type.
 * e.g. "AwsCloudTrail" → "CloudTrail", "AwsS3Bucket" → "S3"
 * Falls back to extracting the service from the resource ARN.
 */
export function extractServiceName(resourceType?: string, resourceId?: string): string | null {
  if (resourceType) {
    // Strip "Aws" prefix: "AwsCloudTrail" → "CloudTrail"
    const stripped = resourceType.replace(/^Aws/, '');
    if (stripped.length > 0) return stripped;
  }
  // Fallback: extract from ARN (arn:aws:SERVICE:region:account:...)
  if (resourceId) {
    const match = resourceId.match(/arn:[^:]*:([^:]+):/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function extractAccountId(resourceId?: string): string | null {
  if (!resourceId) return null;
  const accountMatch = resourceId.match(/arn:[^:]*:[^:]*:([^:]*):(\d{12})/);
  if (accountMatch && accountMatch[2]) {
    return accountMatch[2];
  }
  return null;
}

export function extractRegionFromArn(resourceId?: string): string | null {
  if (!resourceId) return null;
  const match = resourceId.match(/arn:[^:]*:[^:]*:([^:]*):/);
  if (match && match[1]) {
    const region = match[1];
    if (region && region !== '*' && region !== '') {
      return region;
    }
  }
  return null;
}

/**
 * Maps Prowler severity levels to analytics severity enum.
 */
export function mapToAnalyticsSeverity(
  prowlerSeverity: NormalisedSeverity,
): 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none' {
  switch (prowlerSeverity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    case 'informational':
      return 'info';
    case 'unknown':
    default:
      return 'none';
  }
}

export function buildScanId(
  accountId: string,
  scanMode: 'aws' | 'cloud' | 'gcp' | 'kubernetes',
): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  const safeAccount = accountId.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32);
  return `prowler-${scanMode}-${safeAccount}-${timestamp}`;
}

/**
 * Constructs an IAM role ARN from a role name and account ID.
 * Supports both plain role names and full ARN templates with {accountId} placeholder.
 */
export function buildMemberRoleArn(roleNameOrTemplate: string, accountId: string): string {
  if (roleNameOrTemplate.startsWith('arn:')) {
    return roleNameOrTemplate.replace('{accountId}', accountId);
  }
  return `arn:aws:iam::${accountId}:role/${roleNameOrTemplate}`;
}

// ---------------------------------------------------------------------------
// Docker volume helpers
// ---------------------------------------------------------------------------

export async function listVolumeFiles(volume: IsolatedVolume): Promise<string[]> {
  const volumeName = volume.getVolumeName();
  if (!volumeName) return [];

  const dockerPath = await resolveDockerPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(dockerPath, [
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data`,
      '--entrypoint',
      'sh',
      'alpine:3.20',
      '-c',
      "find /data -type f | sed 's#^/data/##'",
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to list volume files: ${stderr.trim()}`));
      } else {
        resolve(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        );
      }
    });
  });
}

export async function setVolumeOwnership(
  volume: IsolatedVolume,
  uid = 1000,
  gid = 1000,
): Promise<void> {
  const volumeName = volume.getVolumeName();
  if (!volumeName) return;

  const dockerPath = await resolveDockerPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(dockerPath, [
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data`,
      '--entrypoint',
      'sh',
      'alpine:3.20',
      '-c',
      `chown -R ${uid}:${gid} /data && chmod -R 777 /data`,
    ]);

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to set volume ownership: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to set volume ownership: ${stderr.trim()}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Prowler's output-volume ownership preparation is only needed for Docker
 * named volumes. K8s volumes are provisioned by the runner and should not
 * assume a local Docker daemon exists.
 */
export function shouldSetVolumeOwnershipForExecutionMode(
  executionMode = process.env.EXECUTION_MODE,
): boolean {
  return executionMode !== 'k8s';
}

/**
 * Split custom CLI flags honoring simple quotes.
 */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) args.push(current);
  return args;
}
