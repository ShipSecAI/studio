/**
 * Analytics helpers for component authors.
 *
 * These utilities help components output structured findings
 * that can be indexed into OpenSearch via the Analytics Sink.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { withPortMeta } from './port-meta';

// Analytics Results Contract
export const analyticsResultContractName = 'core.analytics.result.v1';

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']);

export const analyticsResultSchema = () =>
  withPortMeta(
    z
      .object({
        scanner: z.string().describe('Scanner/component that produced this result'),
        finding_hash: z.string().describe('Stable 16-char hash for deduplication'),
        severity: severitySchema.describe('Finding severity level, use "none" if not applicable'),
        asset_key: z
          .string()
          .optional()
          .describe('Primary asset identifier (auto-detected if missing)'),
      })
      .passthrough(), // Allow scanner-specific fields
    { schemaName: analyticsResultContractName }
  );

export type AnalyticsResult = z.infer<ReturnType<typeof analyticsResultSchema>>;
export type Severity = z.infer<typeof severitySchema>;

/**
 * Generate a stable hash for finding deduplication.
 *
 * The hash is used to track findings across workflow runs:
 * - Identify new vs recurring findings
 * - Calculate first-seen / last-seen timestamps
 * - Deduplicate findings in dashboards
 *
 * @param fields - Key identifying fields of the finding (e.g., templateId, host, matchedAt)
 * @returns 16-character hex string (SHA-256 truncated)
 *
 * @example
 * ```typescript
 * // Nuclei scanner
 * const hash = generateFindingHash(finding.templateId, finding.host, finding.matchedAt);
 *
 * // TruffleHog scanner
 * const hash = generateFindingHash(secret.DetectorType, secret.Redacted, filePath);
 *
 * // Supabase scanner
 * const hash = generateFindingHash(check.check_id, projectRef, check.resource);
 * ```
 */
export function generateFindingHash(
  ...fields: (string | undefined | null)[]
): string {
  const normalized = fields
    .map((f) => (f ?? '').toLowerCase().trim())
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
