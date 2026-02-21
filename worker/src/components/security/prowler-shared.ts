/**
 * Shared types, schemas, and utility functions for the Prowler scan component.
 * Extracted to allow reuse across single-account and org-wide scan modes.
 */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { resolveDockerPath } from '@shipsec/component-sdk';
import type { IsolatedContainerVolume } from '../../utils/isolated-volume';

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
    label: 'Quick scan (removed in v4 \u2014 ignored)',
    description: 'Kept for backwards compatibility; Prowler v4 ignores this option.',
    args: [],
    defaultSelected: false,
  },
  {
    id: 'severity-high-critical',
    label: 'Severity filter: high+critical (--severity high critical)',
    description: 'Limit findings to high and critical severities.',
    args: ['--severity', 'high', 'critical'],
    defaultSelected: true,
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
      })
      .partial()
      .optional(),
    Resources: z
      .array(
        z
          .object({
            Id: z.string().optional(),
            Type: z.string().optional(),
            Region: z.string().optional(),
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

export const runnerPayloadSchema = z.object({
  returncode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  command: z.array(z.string()),
  artifacts: z.array(z.string()).default([]),
  parse_error: z.string().optional(),
});

export const normalisedFindingSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  accountId: z.string().nullable(),
  resourceId: z.string().nullable(),
  region: z.string().nullable(),
  severity: z.enum(severityLevels),
  status: z.enum(statusLevels),
  description: z.string().nullable(),
  remediationText: z.string().nullable(),
  recommendationUrl: z.string().nullable(),
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
      if (!parsed.success) {
        errors.push(
          `Segment ${segmentIndex + 1} item ${candidateIndex + 1}: ${parsed.error.message}`,
        );
        return;
      }
      findings.push(toNormalisedFinding(parsed.data, findings.length, runId));
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
  const severity = normaliseSeverity(finding);
  const status = normaliseStatus(finding.Compliance?.Status);
  const remediationText = finding.Remediation?.Recommendation?.Text ?? null;
  const recommendationUrl = finding.Remediation?.Recommendation?.Url ?? null;

  return {
    id: finding.Id ?? `${runId}-finding-${index + 1}`,
    title: finding.Title ?? null,
    accountId,
    resourceId,
    region,
    severity,
    status,
    description: finding.Description ?? null,
    remediationText,
    recommendationUrl,
    rawFinding: finding,
  };
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

export function buildScanId(accountId: string, scanMode: 'aws' | 'cloud'): string {
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

export async function listVolumeFiles(volume: IsolatedContainerVolume): Promise<string[]> {
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
      'ls -1 /data',
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
  volume: IsolatedContainerVolume,
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
      `chown -R ${uid}:${gid} /data && chmod -R 755 /data`,
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
