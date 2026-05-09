import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import {
  securityAssetAliases,
  securityAssets,
  securityControlMappings,
  securityControlResults,
  securityEvidenceItems,
  securityFindingControlLinks,
  securityFindingInstances,
  securityFindingLinks,
  securityGraphEdges,
  securityIngestionBatches,
  securityObservations,
  securityScannerRuns,
  securityThreatStories,
  securityThreatStoryFindings,
} from '../database/schema/security-ingestion';
import {
  shipsecIngestionBatchSchema,
  type AssetIdentity,
  type EvidenceItem,
  type FindingInstance,
  type Observation,
  type ScannerRun,
  type ShipSecIngestionBatch,
} from '@shipsec/contracts';

type JsonRecord = Record<string, unknown>;
type DatabaseTx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

interface ComplianceRef {
  frameworkKey: string;
  controlId: string;
  raw: string;
}

interface ControlResultDraft {
  id: string;
  frameworkKey: string;
  controlId: string;
  observationId: string;
  findingRefs: string[];
  evidenceRefs: string[];
  scopeRef: string;
  status: string;
  reason?: string;
  evaluatedAt: Date;
  metadata: JsonRecord;
}

interface GraphEdgeDraft {
  id: string;
  edgeKind: string;
  fromNodeRef: string;
  toNodeRef: string;
  confidence: number;
  evidenceRefs: string[];
  properties: JsonRecord;
}

export type FindingLinkRelationship =
  | 'duplicate_of'
  | 'same_root_cause'
  | 'enables'
  | 'contradicts'
  | 'same_asset'
  | 'same_control'
  | 'mitigated_by'
  | 'related';

export interface SecurityFindingLink {
  id: string;
  fromFindingId: string;
  toFindingId: string;
  relationshipType: string;
  confidence: number;
  rationale: string;
  evidenceRefs: string[];
  createdByAgentRunId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  fromFinding: SecurityFindingSummary;
  toFinding: SecurityFindingSummary;
  relatedFinding: SecurityFindingSummary;
  direction: 'outgoing' | 'incoming';
}

export interface SecurityFindingSummary {
  id: string;
  findingKey: string;
  status: string;
  severity: string;
  title?: string | null;
  sourceKind: string;
}

export interface SecurityFinding {
  id: string;
  findingKey: string;
  status: string;
  severity: string;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceKind: string;
  sourceVersion?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  runId?: string | null;
  repository?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  prNumber?: string | null;
  reviewMode?: string | null;
  lifecycleHint?: string | null;
  title?: string | null;
  description?: string | null;
  impact?: string | null;
  fix?: string | null;
  verification?: string | null;
  file?: string | null;
  line?: number | null;
  endpoint?: string | null;
  asset?: {
    id: string;
    kind: string;
    stableKey: string;
    displayName: string;
  } | null;
  threatRefs: string[];
  linkedFindingKeys: string[];
  relatedLinks: SecurityFindingLink[];
  evidence: { id: string; summary?: string | null; artifactUri: string; capturedAt: string }[];
  observations: {
    id: string;
    status?: string | null;
    title: string;
    observedAt: string;
    runId?: string | null;
    reviewMode?: string | null;
    lifecycleHint?: string | null;
    prNumber?: string | null;
  }[];
}

export interface SecurityThreatStoryFinding extends SecurityFindingSummary {
  role: string;
  rationale?: string | null;
}

export interface SecurityThreatStory {
  id: string;
  storyKey: string;
  title: string;
  status: string;
  severity: string;
  confidence: number;
  summary: string;
  impact: string;
  attackPath?: string | null;
  recommendedAction?: string | null;
  affectedAssetRefs: string[];
  evidenceRefs: string[];
  createdByAgentRunId?: string | null;
  createdBy?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  findings: SecurityThreatStoryFinding[];
  metadata: JsonRecord;
}

function stableHash(...parts: unknown[]): string {
  return createHash('sha256')
    .update(parts.map((part) => (part == null ? '' : JSON.stringify(part))).join('|'))
    .digest('hex')
    .slice(0, 24);
}

function parseDate(value: string | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string' && value.trim().length > 0) {
    output.push(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return output;
  }
  const record = toRecord(value);
  for (const item of Object.values(record)) collectStrings(item, output);
  return output;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date().toISOString();
}

function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function normalizeStatusForControl(status?: string): string {
  const normalized = (status ?? '').toUpperCase();
  if (normalized.includes('FAIL') || normalized === 'OPEN' || normalized === 'MATCHED') {
    return 'fail';
  }
  if (normalized.includes('WARN')) return 'warn';
  if (normalized.includes('PASS')) return 'pass';
  return 'unknown';
}

function cleanControlId(value: string): string {
  return value
    .trim()
    .replace(/^[/:#\s-]+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 128);
}

function extractComplianceRef(rawValue: string): ComplianceRef | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  const statusOnly = new Set([
    'FAILED',
    'PASSED',
    'WARNING',
    'UNKNOWN',
    'NOT_AVAILABLE',
    'NOT_APPLICABLE',
  ]);
  if (statusOnly.has(raw.toUpperCase())) return null;

  const lower = raw.toLowerCase();
  const controlAfterSlash = raw.match(/\/\s*([^/]+)$/)?.[1];
  const dottedNumber = raw.match(/\b\d+(?:\.\d+)+[a-z]?\b/i)?.[0];
  const integerControl = raw.match(/\b\d{1,3}\b/)?.[0];

  if (lower.includes('cis')) {
    return {
      frameworkKey: 'cis',
      controlId: cleanControlId(controlAfterSlash ?? dottedNumber ?? integerControl ?? raw),
      raw,
    };
  }

  if (lower.includes('nist')) {
    const control = raw.match(/\b[A-Z]{2,3}-\d+(?:\(\d+\))?\b/i)?.[0];
    return {
      frameworkKey: 'nist',
      controlId: cleanControlId(control?.toUpperCase() ?? controlAfterSlash ?? raw),
      raw,
    };
  }

  if (lower.includes('pci')) {
    return {
      frameworkKey: 'pci',
      controlId: cleanControlId(controlAfterSlash ?? dottedNumber ?? raw),
      raw,
    };
  }

  if (lower.includes('soc 2') || lower.includes('soc2')) {
    const control = raw.match(/\b(?:CC|A|PI|C)\d+(?:\.\d+)?\b/i)?.[0];
    return {
      frameworkKey: 'soc2',
      controlId: cleanControlId(control?.toUpperCase() ?? controlAfterSlash ?? raw),
      raw,
    };
  }

  if (lower.includes('iso')) {
    const control = raw.match(/\bA\.\d+(?:\.\d+)*\b/i)?.[0] ?? dottedNumber;
    return {
      frameworkKey: 'iso27001',
      controlId: cleanControlId(control ?? controlAfterSlash ?? raw),
      raw,
    };
  }

  if (lower.includes('hipaa')) {
    return {
      frameworkKey: 'hipaa',
      controlId: cleanControlId(controlAfterSlash ?? dottedNumber ?? raw),
      raw,
    };
  }

  const awsSecurityHubControl = raw.match(/^[A-Z][A-Z0-9_]*\.\d+(?:\.\d+)?$/i)?.[0];
  if (awsSecurityHubControl) {
    return {
      frameworkKey: 'aws_security_hub',
      controlId: cleanControlId(awsSecurityHubControl.toUpperCase()),
      raw,
    };
  }

  return null;
}

function extractComplianceRefs(observation: Observation): ComplianceRef[] {
  const normalized = toRecord(observation.normalized);
  const values = collectStrings(normalized.compliance);
  const byKey = new Map<string, ComplianceRef>();

  for (const value of values) {
    const ref = extractComplianceRef(value);
    if (!ref) continue;
    byKey.set(`${ref.frameworkKey}:${ref.controlId}`, ref);
  }

  return Array.from(byKey.values());
}

function buildNodeRef(kind: string, id: string): string {
  return `${kind}:${id}`;
}

@Injectable()
export class SecurityIngestionService {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async persistBatch(organizationId: string, rawBatch: unknown) {
    if (!organizationId) {
      throw new BadRequestException('Organization context required');
    }

    const batch = shipsecIngestionBatchSchema().parse(rawBatch);
    if (batch.organizationId !== organizationId) {
      throw new BadRequestException('Batch organization does not match request organization');
    }

    const now = new Date();
    const assetIds = new Set(batch.assets.map((asset) => asset.id));
    const evidenceIds = new Set(batch.evidenceItems.map((evidence) => evidence.id));
    const findingsByObservation = this.indexFindingsByObservation(batch.findingInstances);
    const controlResults = this.buildControlResults(batch, findingsByObservation);
    const graphEdges = this.buildGraphEdges(batch, controlResults);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(securityScannerRuns)
        .values(this.mapScannerRun(batch.scannerRun, now))
        .onConflictDoUpdate({
          target: securityScannerRuns.id,
          set: {
            sourceVersion: batch.scannerRun.sourceVersion,
            scope: batch.scannerRun.scope,
            triggerKind: batch.scannerRun.triggerKind,
            status: batch.scannerRun.status,
            startedAt: parseDate(batch.scannerRun.startedAt, now),
            completedAt: batch.scannerRun.completedAt
              ? parseDate(batch.scannerRun.completedAt, now)
              : null,
            artifactRefs: batch.scannerRun.artifactRefs,
            workflowId: batch.scannerRun.workflowId,
            runId: batch.scannerRun.runId,
            nodeRef: batch.scannerRun.nodeRef,
            updatedAt: now,
          },
        });

      await tx
        .insert(securityIngestionBatches)
        .values({
          id: batch.id,
          organizationId: batch.organizationId,
          sourceKind: batch.sourceKind,
          scannerRunId: batch.scannerRun.id,
          stats: batch.stats,
          validation: batch.validation,
          rawBatch: batch as unknown as JsonRecord,
          createdAt: parseDate(batch.createdAt, now),
          ingestedAt: now,
        })
        .onConflictDoUpdate({
          target: securityIngestionBatches.id,
          set: {
            stats: batch.stats,
            validation: batch.validation,
            rawBatch: batch as unknown as JsonRecord,
            ingestedAt: now,
          },
        });

      if (batch.assets.length > 0) {
        await tx
          .insert(securityAssets)
          .values(batch.assets.map((asset) => this.mapAsset(asset, now)))
          .onConflictDoUpdate({
            target: securityAssets.id,
            set: {
              displayName: sql`excluded.display_name`,
              aliases: sql`excluded.aliases`,
              confidence: sql`excluded.confidence`,
              ownerRef: sql`excluded.owner_ref`,
              environment: sql`excluded.environment`,
              criticality: sql`excluded.criticality`,
              lastSeenAt: sql`excluded.last_seen_at`,
              metadata: sql`excluded.metadata`,
              updatedAt: now,
            },
          });

        const aliasRows = this.buildAssetAliases(batch.assets, batch.sourceKind, now);
        if (aliasRows.length > 0) {
          await tx
            .insert(securityAssetAliases)
            .values(aliasRows)
            .onConflictDoUpdate({
              target: [
                securityAssetAliases.organizationId,
                securityAssetAliases.aliasType,
                securityAssetAliases.aliasValue,
              ],
              set: {
                assetId: sql`excluded.asset_id`,
                sourceKind: sql`excluded.source_kind`,
                confidence: sql`excluded.confidence`,
                metadata: sql`excluded.metadata`,
                updatedAt: now,
              },
            });
        }
      }

      if (batch.evidenceItems.length > 0) {
        await tx
          .insert(securityEvidenceItems)
          .values(batch.evidenceItems.map((evidence) => this.mapEvidence(evidence, now)))
          .onConflictDoUpdate({
            target: securityEvidenceItems.id,
            set: {
              summary: sql`excluded.summary`,
              hash: sql`excluded.hash`,
              retentionClass: sql`excluded.retention_class`,
              metadata: sql`excluded.metadata`,
            },
          });
      }

      if (batch.observations.length > 0) {
        await tx
          .insert(securityObservations)
          .values(
            batch.observations.map((observation) =>
              this.mapObservation(observation, assetIds, evidenceIds, now),
            ),
          )
          .onConflictDoUpdate({
            target: securityObservations.id,
            set: {
              status: sql`excluded.status`,
              severity: sql`excluded.severity`,
              title: sql`excluded.title`,
              rawArtifactRef: sql`excluded.raw_artifact_ref`,
              evidenceRefs: sql`excluded.evidence_refs`,
              observedAt: sql`excluded.observed_at`,
              normalized: sql`excluded.normalized`,
            },
          });
      }

      if (batch.findingInstances.length > 0) {
        await tx
          .insert(securityFindingInstances)
          .values(
            batch.findingInstances.map((finding) =>
              this.mapFinding(finding, assetIds, evidenceIds, now),
            ),
          )
          .onConflictDoUpdate({
            target: securityFindingInstances.id,
            set: {
              scannerRunId: sql`excluded.scanner_run_id`,
              assetId: sql`excluded.asset_id`,
              status: sql`excluded.status`,
              severity: sql`excluded.severity`,
              confidence: sql`excluded.confidence`,
              lastSeenAt: sql`excluded.last_seen_at`,
              observationRefs: sql`excluded.observation_refs`,
              evidenceRefs: sql`excluded.evidence_refs`,
              suppressionRef: sql`excluded.suppression_ref`,
              acceptedRiskRef: sql`excluded.accepted_risk_ref`,
              metadata: sql`excluded.metadata`,
              updatedAt: now,
            },
          });
      }

      await this.persistComplianceRows(tx, batch, controlResults, now);

      if (graphEdges.length > 0) {
        await tx
          .insert(securityGraphEdges)
          .values(
            graphEdges.map((edge) => ({
              organizationId,
              ...edge,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: securityGraphEdges.id,
            set: {
              confidence: sql`excluded.confidence`,
              evidenceRefs: sql`excluded.evidence_refs`,
              properties: sql`excluded.properties`,
              updatedAt: now,
            },
          });
      }
    });

    return {
      batchId: batch.id,
      scannerRunId: batch.scannerRun.id,
      assetCount: batch.assets.length,
      observationCount: batch.observations.length,
      findingCount: batch.findingInstances.length,
      evidenceCount: batch.evidenceItems.length,
      controlResultCount: controlResults.length,
      graphEdgeCount: graphEdges.length,
    };
  }

  async listFindings(
    organizationId: string,
    options: { sourceKind?: string; status?: string; limit?: number } = {},
  ): Promise<{ findings: SecurityFinding[] }> {
    return this.queryFindings(organizationId, options);
  }

  async getFinding(organizationId: string, findingId: string): Promise<SecurityFinding | null> {
    const result = await this.queryFindings(organizationId, {
      findingId,
      limit: 1,
    });
    return result.findings[0] ?? null;
  }

  async getFindingEvidence(
    organizationId: string,
    findingId: string,
  ): Promise<SecurityFinding['evidence'] | null> {
    const finding = await this.getFinding(organizationId, findingId);
    return finding ? finding.evidence : null;
  }

  async listThreatStories(
    organizationId: string,
    options: { status?: string; limit?: number } = {},
  ): Promise<{ stories: SecurityThreatStory[] }> {
    return this.queryThreatStories(organizationId, options);
  }

  async getThreatStory(
    organizationId: string,
    storyId: string,
  ): Promise<SecurityThreatStory | null> {
    const result = await this.queryThreatStories(organizationId, { storyId, limit: 1 });
    return result.stories[0] ?? null;
  }

  async recordThreatStory(
    organizationId: string,
    input: {
      storyKey?: string;
      title: string;
      status?: string;
      severity: string;
      confidence?: number;
      summary: string;
      impact: string;
      attackPath?: string | null;
      recommendedAction?: string | null;
      findingIds: string[];
      findingRoles?: Record<string, string>;
      findingRationales?: Record<string, string>;
      evidenceRefs?: string[];
      affectedAssetRefs?: string[];
      createdByAgentRunId?: string | null;
      createdBy?: string | null;
      metadata?: JsonRecord;
    },
  ): Promise<SecurityThreatStory> {
    const title = input.title.trim();
    const summary = input.summary.trim();
    const impact = input.impact.trim();
    const severity = input.severity.trim().toLowerCase();
    const storyKey =
      input.storyKey?.trim() ||
      `agent:${stableHash(title, severity, [...new Set(input.findingIds)].sort())}`;
    const findingIds = [...new Set(input.findingIds.map((id) => id.trim()).filter(Boolean))];
    if (!title || !summary || !impact) {
      throw new BadRequestException('Threat story title, summary, and impact are required');
    }
    if (findingIds.length === 0) {
      throw new BadRequestException('Threat story requires at least one finding');
    }

    const existingFindings = await this.existingFindingIds(organizationId, findingIds);
    if (existingFindings.size !== findingIds.length) {
      throw new BadRequestException('All threat story findings must exist in the organization');
    }

    const now = new Date();
    const id = `threat-story:${stableHash(organizationId, storyKey)}`;
    const confidence = Math.min(Math.max(input.confidence ?? 0.7, 0), 1);

    await this.db
      .insert(securityThreatStories)
      .values({
        id,
        organizationId,
        storyKey,
        title,
        status: input.status?.trim() || 'open',
        severity,
        confidence,
        summary,
        impact,
        attackPath: input.attackPath?.trim() || null,
        recommendedAction: input.recommendedAction?.trim() || null,
        affectedAssetRefs: [...new Set(input.affectedAssetRefs ?? [])],
        evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
        createdByAgentRunId: input.createdByAgentRunId ?? null,
        createdBy: input.createdBy ?? null,
        metadata: input.metadata ?? {},
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [securityThreatStories.organizationId, securityThreatStories.storyKey],
        set: {
          title,
          status: input.status?.trim() || 'open',
          severity,
          confidence,
          summary,
          impact,
          attackPath: input.attackPath?.trim() || null,
          recommendedAction: input.recommendedAction?.trim() || null,
          affectedAssetRefs: [...new Set(input.affectedAssetRefs ?? [])],
          evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
          createdByAgentRunId: input.createdByAgentRunId ?? null,
          createdBy: input.createdBy ?? null,
          metadata: input.metadata ?? {},
          lastSeenAt: now,
          updatedAt: now,
        },
      });

    const story = await this.findThreatStoryByKey(organizationId, storyKey);
    if (!story) throw new Error('Threat story was not created');

    await this.db.execute(sql`
      DELETE FROM security_threat_story_findings
      WHERE organization_id = ${organizationId}
        AND story_id = ${story.id}
    `);
    await this.db.insert(securityThreatStoryFindings).values(
      findingIds.map((findingId) => ({
        organizationId,
        storyId: story.id,
        findingId,
        role: input.findingRoles?.[findingId] ?? 'supporting',
        rationale: input.findingRationales?.[findingId] ?? null,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const refreshed = await this.getThreatStory(organizationId, story.id);
    if (!refreshed) throw new Error('Threat story was not loaded');
    return refreshed;
  }

  private async queryFindings(
    organizationId: string,
    options: { sourceKind?: string; status?: string; findingId?: string; limit?: number } = {},
  ): Promise<{ findings: SecurityFinding[] }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const conditions = [sql`fi.organization_id = ${organizationId}`];
    if (options.findingId) conditions.push(sql`fi.id = ${options.findingId}`);
    if (options.sourceKind) conditions.push(sql`sr.source_kind = ${options.sourceKind}`);
    if (options.status) conditions.push(sql`fi.status = ${options.status}`);

    const result = await this.db.execute(sql`
      SELECT
        fi.id,
        fi.finding_key,
        fi.status,
        fi.severity,
        fi.confidence,
        fi.first_seen_at,
        fi.last_seen_at,
        fi.observation_refs,
        fi.evidence_refs,
        sr.source_kind,
        sr.source_version,
        sr.workflow_id,
        sr.run_id,
        sr.scope,
        a.id AS asset_id,
        a.asset_kind,
        a.stable_key,
        a.display_name,
        latest_obs.id AS latest_observation_id,
        latest_obs.title AS latest_title,
        latest_obs.status AS latest_observation_status,
        latest_obs.observed_at AS latest_observed_at,
        latest_obs.normalized AS latest_normalized
      FROM security_finding_instances fi
      JOIN security_scanner_runs sr ON sr.id = fi.scanner_run_id
      LEFT JOIN security_assets a ON a.id = fi.asset_id
      LEFT JOIN LATERAL (
        SELECT o.*
        FROM security_observations o
        WHERE o.id IN (SELECT jsonb_array_elements_text(fi.observation_refs))
        ORDER BY o.observed_at DESC
        LIMIT 1
      ) latest_obs ON true
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY
        CASE fi.severity
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        fi.last_seen_at DESC
      LIMIT ${limit}
    `);

    const rows = result.rows as Record<string, unknown>[];
    if (rows.length === 0) return { findings: [] };

    const observationIds = [
      ...new Set(rows.flatMap((row) => jsonStringArray(row.observation_refs))),
    ];
    const evidenceIds = [...new Set(rows.flatMap((row) => jsonStringArray(row.evidence_refs)))];

    const observationsByFinding = await this.loadObservationsByFinding(observationIds);
    const evidenceByFinding = await this.loadEvidenceByFinding(evidenceIds);
    const linksByFinding = await this.loadLinksByFinding(
      organizationId,
      rows.map((row) => String(row.id)),
    );

    return {
      findings: rows.map((row) =>
        this.mapFindingRow(row, observationsByFinding, evidenceByFinding, linksByFinding),
      ),
    };
  }

  private async queryThreatStories(
    organizationId: string,
    options: { status?: string; storyId?: string; limit?: number } = {},
  ): Promise<{ stories: SecurityThreatStory[] }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const conditions = [sql`ts.organization_id = ${organizationId}`];
    if (options.storyId) conditions.push(sql`ts.id = ${options.storyId}`);
    if (options.status) conditions.push(sql`ts.status = ${options.status}`);

    const result = await this.db.execute(sql`
      SELECT
        ts.id,
        ts.story_key,
        ts.title,
        ts.status,
        ts.severity,
        ts.confidence,
        ts.summary,
        ts.impact,
        ts.attack_path,
        ts.recommended_action,
        ts.affected_asset_refs,
        ts.evidence_refs,
        ts.created_by_agent_run_id,
        ts.created_by,
        ts.metadata,
        ts.first_seen_at,
        ts.last_seen_at,
        ts.created_at,
        ts.updated_at
      FROM security_threat_stories ts
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY
        CASE ts.severity
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        ts.updated_at DESC
      LIMIT ${limit}
    `);

    const rows = result.rows as Record<string, unknown>[];
    if (rows.length === 0) return { stories: [] };
    const findingsByStory = await this.loadThreatStoryFindings(
      organizationId,
      rows.map((row) => String(row.id)),
    );

    return {
      stories: rows.map((row) => this.mapThreatStoryRow(row, findingsByStory)),
    };
  }

  private async findThreatStoryByKey(
    organizationId: string,
    storyKey: string,
  ): Promise<{ id: string } | null> {
    const result = await this.db.execute(sql`
      SELECT id
      FROM security_threat_stories
      WHERE organization_id = ${organizationId}
        AND story_key = ${storyKey}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? { id: String(row.id) } : null;
  }

  async listFindingLinks(
    organizationId: string,
    findingId: string,
  ): Promise<{ links: SecurityFindingLink[] } | null> {
    const exists = await this.findingExists(organizationId, findingId);
    if (!exists) return null;
    const linksByFinding = await this.loadLinksByFinding(organizationId, [findingId]);
    return { links: linksByFinding.get(findingId) ?? [] };
  }

  async recordFindingLink(
    organizationId: string,
    input: {
      fromFindingId: string;
      toFindingId: string;
      relationshipType: FindingLinkRelationship | string;
      confidence?: number;
      rationale: string;
      evidenceRefs?: string[];
      createdByAgentRunId?: string | null;
      createdBy?: string | null;
      metadata?: JsonRecord;
    },
  ): Promise<SecurityFindingLink> {
    if (input.fromFindingId === input.toFindingId) {
      throw new BadRequestException('Cannot link a finding to itself');
    }
    if (!input.rationale.trim()) {
      throw new BadRequestException('Finding link rationale is required');
    }

    const [fromExists, toExists] = await Promise.all([
      this.findingExists(organizationId, input.fromFindingId),
      this.findingExists(organizationId, input.toFindingId),
    ]);
    if (!fromExists || !toExists) {
      throw new BadRequestException('Both findings must exist in the organization');
    }

    const now = new Date();
    const confidence = Math.min(Math.max(input.confidence ?? 0.7, 0), 1);
    const evidenceRefs = [...new Set(input.evidenceRefs ?? [])];
    const relationshipType = input.relationshipType.trim();

    await this.db
      .insert(securityFindingLinks)
      .values({
        organizationId,
        fromFindingId: input.fromFindingId,
        toFindingId: input.toFindingId,
        relationshipType,
        confidence,
        rationale: input.rationale.trim(),
        evidenceRefs,
        createdByAgentRunId: input.createdByAgentRunId ?? null,
        createdBy: input.createdBy ?? null,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          securityFindingLinks.organizationId,
          securityFindingLinks.fromFindingId,
          securityFindingLinks.toFindingId,
          securityFindingLinks.relationshipType,
        ],
        set: {
          confidence,
          rationale: input.rationale.trim(),
          evidenceRefs,
          createdByAgentRunId: input.createdByAgentRunId ?? null,
          createdBy: input.createdBy ?? null,
          metadata: input.metadata ?? {},
          updatedAt: now,
        },
      });

    const links = await this.loadLinksByFinding(organizationId, [input.fromFindingId]);
    const link = links
      .get(input.fromFindingId)
      ?.find(
        (candidate) =>
          candidate.fromFindingId === input.fromFindingId &&
          candidate.toFindingId === input.toFindingId &&
          candidate.relationshipType === relationshipType,
      );
    if (!link) throw new Error('Finding link was not created');
    return link;
  }

  private async findingExists(organizationId: string, findingId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
      FROM security_finding_instances
      WHERE organization_id = ${organizationId}
        AND id = ${findingId}
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  private async existingFindingIds(
    organizationId: string,
    findingIds: string[],
  ): Promise<Set<string>> {
    if (findingIds.length === 0) return new Set();
    const ids = sql`ARRAY[${sql.join(
      findingIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = await this.db.execute(sql`
      SELECT id
      FROM security_finding_instances
      WHERE organization_id = ${organizationId}
        AND id = ANY(${ids})
    `);
    return new Set((result.rows as Record<string, unknown>[]).map((row) => String(row.id)));
  }

  private async loadThreatStoryFindings(organizationId: string, storyIds: string[]) {
    const byStory = new Map<string, SecurityThreatStoryFinding[]>();
    if (storyIds.length === 0) return byStory;
    for (const id of storyIds) byStory.set(id, []);

    const ids = sql`ARRAY[${sql.join(
      storyIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = await this.db.execute(sql`
      SELECT
        tsf.story_id,
        tsf.finding_id,
        tsf.role,
        tsf.rationale,
        fi.finding_key AS finding_key,
        fi.status AS status,
        fi.severity AS severity,
        sr.source_kind AS source_kind,
        latest.title AS title
      FROM security_threat_story_findings tsf
      JOIN security_finding_instances fi ON fi.id = tsf.finding_id
      JOIN security_scanner_runs sr ON sr.id = fi.scanner_run_id
      LEFT JOIN LATERAL (
        SELECT o.title
        FROM security_observations o
        WHERE o.id IN (SELECT jsonb_array_elements_text(fi.observation_refs))
        ORDER BY o.observed_at DESC
        LIMIT 1
      ) latest ON true
      WHERE tsf.organization_id = ${organizationId}
        AND tsf.story_id = ANY(${ids})
      ORDER BY tsf.created_at ASC
    `);

    for (const row of result.rows as Record<string, unknown>[]) {
      const storyId = String(row.story_id);
      byStory.get(storyId)?.push({
        id: String(row.finding_id),
        findingKey: String(row.finding_key),
        status: String(row.status),
        severity: String(row.severity),
        title: stringOrNull(row.title),
        sourceKind: String(row.source_kind),
        role: String(row.role),
        rationale: stringOrNull(row.rationale),
      });
    }

    return byStory;
  }

  private mapThreatStoryRow(
    row: Record<string, unknown>,
    findingsByStory: Map<string, SecurityThreatStoryFinding[]>,
  ): SecurityThreatStory {
    const id = String(row.id);
    return {
      id,
      storyKey: String(row.story_key),
      title: String(row.title),
      status: String(row.status),
      severity: String(row.severity),
      confidence: Number(row.confidence ?? 0),
      summary: String(row.summary),
      impact: String(row.impact),
      attackPath: stringOrNull(row.attack_path),
      recommendedAction: stringOrNull(row.recommended_action),
      affectedAssetRefs: jsonStringArray(row.affected_asset_refs),
      evidenceRefs: jsonStringArray(row.evidence_refs),
      createdByAgentRunId: stringOrNull(row.created_by_agent_run_id),
      createdBy: stringOrNull(row.created_by),
      metadata: toRecord(row.metadata),
      firstSeenAt: dateString(row.first_seen_at),
      lastSeenAt: dateString(row.last_seen_at),
      createdAt: dateString(row.created_at),
      updatedAt: dateString(row.updated_at),
      findings: findingsByStory.get(id) ?? [],
    };
  }

  private async loadObservationsByFinding(observationIds: string[]) {
    const byId = new Map<string, SecurityFinding['observations'][number]>();
    if (observationIds.length === 0) return byId;
    const ids = sql`ARRAY[${sql.join(
      observationIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = await this.db.execute(sql`
      SELECT o.id, o.status, o.title, o.observed_at, o.normalized, sr.run_id
      FROM security_observations o
      JOIN security_scanner_runs sr ON sr.id = o.scanner_run_id
      WHERE o.id = ANY(${ids})
      ORDER BY o.observed_at DESC
    `);
    for (const row of result.rows as Record<string, unknown>[]) {
      const normalized = toRecord(row.normalized);
      byId.set(String(row.id), {
        id: String(row.id),
        status: row.status == null ? null : String(row.status),
        title: String(row.title),
        observedAt: dateString(row.observed_at),
        runId: row.run_id == null ? null : String(row.run_id),
        reviewMode: stringOrNull(normalized.reviewMode),
        lifecycleHint: stringOrNull(normalized.lifecycleHint),
        prNumber: stringOrNull(normalized.prNumber),
      });
    }
    return byId;
  }

  private async loadEvidenceByFinding(evidenceIds: string[]) {
    const byId = new Map<string, SecurityFinding['evidence'][number]>();
    if (evidenceIds.length === 0) return byId;
    const ids = sql`ARRAY[${sql.join(
      evidenceIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = await this.db.execute(sql`
      SELECT id, summary, artifact_uri, captured_at
      FROM security_evidence_items
      WHERE id = ANY(${ids})
      ORDER BY captured_at DESC
    `);
    for (const row of result.rows as Record<string, unknown>[]) {
      byId.set(String(row.id), {
        id: String(row.id),
        summary: row.summary == null ? null : String(row.summary),
        artifactUri: String(row.artifact_uri),
        capturedAt: dateString(row.captured_at),
      });
    }
    return byId;
  }

  private async loadLinksByFinding(organizationId: string, findingIds: string[]) {
    const byFinding = new Map<string, SecurityFindingLink[]>();
    if (findingIds.length === 0) return byFinding;
    for (const id of findingIds) byFinding.set(id, []);

    const ids = sql`ARRAY[${sql.join(
      findingIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const result = await this.db.execute(sql`
      SELECT
        l.id,
        l.from_finding_id,
        l.to_finding_id,
        l.relationship_type,
        l.confidence,
        l.rationale,
        l.evidence_refs,
        l.created_by_agent_run_id,
        l.created_by,
        l.created_at,
        l.updated_at,
        from_finding.finding_key AS from_finding_key,
        from_finding.status AS from_status,
        from_finding.severity AS from_severity,
        from_run.source_kind AS from_source_kind,
        from_latest.title AS from_title,
        to_finding.finding_key AS to_finding_key,
        to_finding.status AS to_status,
        to_finding.severity AS to_severity,
        to_run.source_kind AS to_source_kind,
        to_latest.title AS to_title
      FROM security_finding_links l
      JOIN security_finding_instances from_finding ON from_finding.id = l.from_finding_id
      JOIN security_scanner_runs from_run ON from_run.id = from_finding.scanner_run_id
      JOIN security_finding_instances to_finding ON to_finding.id = l.to_finding_id
      JOIN security_scanner_runs to_run ON to_run.id = to_finding.scanner_run_id
      LEFT JOIN LATERAL (
        SELECT o.title
        FROM security_observations o
        WHERE o.id IN (SELECT jsonb_array_elements_text(from_finding.observation_refs))
        ORDER BY o.observed_at DESC
        LIMIT 1
      ) from_latest ON true
      LEFT JOIN LATERAL (
        SELECT o.title
        FROM security_observations o
        WHERE o.id IN (SELECT jsonb_array_elements_text(to_finding.observation_refs))
        ORDER BY o.observed_at DESC
        LIMIT 1
      ) to_latest ON true
      WHERE l.organization_id = ${organizationId}
        AND (l.from_finding_id = ANY(${ids}) OR l.to_finding_id = ANY(${ids}))
      ORDER BY l.created_at DESC
    `);

    for (const row of result.rows as Record<string, unknown>[]) {
      const fromFindingId = String(row.from_finding_id);
      const toFindingId = String(row.to_finding_id);
      const fromFinding = this.mapFindingSummary(row, 'from');
      const toFinding = this.mapFindingSummary(row, 'to');
      const linkBase = {
        id: String(row.id),
        fromFindingId,
        toFindingId,
        relationshipType: String(row.relationship_type),
        confidence: Number(row.confidence ?? 0),
        rationale: String(row.rationale),
        evidenceRefs: jsonStringArray(row.evidence_refs),
        createdByAgentRunId: stringOrNull(row.created_by_agent_run_id),
        createdBy: stringOrNull(row.created_by),
        createdAt: dateString(row.created_at),
        updatedAt: dateString(row.updated_at),
        fromFinding,
        toFinding,
      };

      if (byFinding.has(fromFindingId)) {
        byFinding.get(fromFindingId)?.push({
          ...linkBase,
          relatedFinding: toFinding,
          direction: 'outgoing',
        });
      }
      if (byFinding.has(toFindingId)) {
        byFinding.get(toFindingId)?.push({
          ...linkBase,
          relatedFinding: fromFinding,
          direction: 'incoming',
        });
      }
    }

    return byFinding;
  }

  private mapFindingSummary(row: Record<string, unknown>, prefix: 'from' | 'to') {
    return {
      id: String(row[`${prefix}_finding_id`]),
      findingKey: String(row[`${prefix}_finding_key`]),
      status: String(row[`${prefix}_status`]),
      severity: String(row[`${prefix}_severity`]),
      title: stringOrNull(row[`${prefix}_title`]),
      sourceKind: String(row[`${prefix}_source_kind`]),
    };
  }

  private mapFindingRow(
    row: Record<string, unknown>,
    observationsById: Map<string, SecurityFinding['observations'][number]>,
    evidenceById: Map<string, SecurityFinding['evidence'][number]>,
    linksById: Map<string, SecurityFindingLink[]>,
  ): SecurityFinding {
    const normalized = toRecord(row.latest_normalized);
    const scope = toRecord(row.scope);
    const agentFinding = toRecord(normalized.agentFinding);
    const observationRefs = jsonStringArray(row.observation_refs);
    const evidenceRefs = jsonStringArray(row.evidence_refs);

    return {
      id: String(row.id),
      findingKey: String(row.finding_key),
      status: String(row.status),
      severity: String(row.severity),
      confidence: Number(row.confidence ?? 0),
      firstSeenAt: dateString(row.first_seen_at),
      lastSeenAt: dateString(row.last_seen_at),
      sourceKind: String(row.source_kind),
      sourceVersion: stringOrNull(row.source_version),
      workflowId: stringOrNull(row.workflow_id),
      workflowName: stringOrNull(toRecord(scope.labels).workflowName),
      runId: stringOrNull(row.run_id),
      repository: stringOrNull(normalized.repository ?? scope.repository),
      branch: stringOrNull(normalized.branch),
      commitSha: stringOrNull(normalized.commitSha),
      prNumber: stringOrNull(normalized.prNumber),
      reviewMode: stringOrNull(normalized.reviewMode),
      lifecycleHint: stringOrNull(normalized.lifecycleHint),
      title: stringOrNull(row.latest_title),
      description: stringOrNull(agentFinding.description ?? normalized.description),
      impact: stringOrNull(normalized.impact),
      fix: stringOrNull(normalized.fix),
      verification: stringOrNull(normalized.verification),
      file: stringOrNull(normalized.file),
      line: numberOrNull(normalized.line),
      endpoint: stringOrNull(normalized.endpoint),
      asset: row.asset_id
        ? {
            id: String(row.asset_id),
            kind: String(row.asset_kind),
            stableKey: String(row.stable_key),
            displayName: String(row.display_name),
          }
        : null,
      threatRefs: jsonStringArray(normalized.threatRefs),
      linkedFindingKeys: jsonStringArray(normalized.linkedFindingKeys),
      relatedLinks: linksById.get(String(row.id)) ?? [],
      evidence: evidenceRefs.map((id) => evidenceById.get(id)).filter(isDefined),
      observations: observationRefs.map((id) => observationsById.get(id)).filter(isDefined),
    };
  }

  private mapScannerRun(scannerRun: ScannerRun, now: Date) {
    return {
      id: scannerRun.id,
      organizationId: scannerRun.organizationId,
      sourceKind: scannerRun.sourceKind,
      sourceVersion: scannerRun.sourceVersion,
      scope: scannerRun.scope,
      triggerKind: scannerRun.triggerKind,
      status: scannerRun.status,
      startedAt: parseDate(scannerRun.startedAt, now),
      completedAt: scannerRun.completedAt ? parseDate(scannerRun.completedAt, now) : null,
      parentRunId: scannerRun.parentRunId,
      artifactRefs: scannerRun.artifactRefs,
      configHash: scannerRun.configHash,
      workflowId: scannerRun.workflowId,
      runId: scannerRun.runId,
      nodeRef: scannerRun.nodeRef,
      createdBy: scannerRun.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  private mapAsset(asset: AssetIdentity, now: Date) {
    return {
      id: asset.id,
      organizationId: asset.organizationId,
      assetKind: asset.assetKind,
      provider: asset.provider,
      nativeId: asset.nativeId,
      stableKey: asset.stableKey,
      displayName: asset.displayName,
      aliases: asset.aliases,
      confidence: asset.confidence,
      ownerRef: asset.ownerRef,
      environment: asset.environment,
      criticality: asset.criticality,
      firstSeenAt: asset.firstSeenAt ? parseDate(asset.firstSeenAt, now) : null,
      lastSeenAt: asset.lastSeenAt ? parseDate(asset.lastSeenAt, now) : null,
      metadata: asset.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  private buildAssetAliases(
    assets: AssetIdentity[],
    sourceKind: string,
    now: Date,
  ): (typeof securityAssetAliases.$inferInsert)[] {
    const rows = new Map<string, typeof securityAssetAliases.$inferInsert>();
    for (const asset of assets) {
      const aliases = [asset.stableKey, asset.nativeId, ...asset.aliases].filter(
        (alias): alias is string => typeof alias === 'string' && alias.trim().length > 0,
      );

      for (const alias of aliases) {
        const aliasType =
          alias === asset.stableKey
            ? 'stable_key'
            : alias === asset.nativeId
              ? 'native_id'
              : 'alias';
        const key = `${asset.organizationId}:${aliasType}:${alias}`;
        rows.set(key, {
          organizationId: asset.organizationId,
          assetId: asset.id,
          aliasType,
          aliasValue: alias,
          sourceKind,
          confidence: asset.confidence,
          metadata: { assetKind: asset.assetKind, provider: asset.provider },
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return Array.from(rows.values());
  }

  private mapEvidence(evidence: EvidenceItem, now: Date) {
    return {
      id: evidence.id,
      organizationId: evidence.organizationId,
      kind: evidence.kind,
      sourceKind: evidence.sourceKind,
      scannerRunId: evidence.scannerRunId,
      artifactUri: evidence.artifactUri,
      summary: evidence.summary,
      hash: evidence.hash,
      capturedAt: parseDate(evidence.capturedAt, now),
      retentionClass: evidence.retentionClass,
      metadata: evidence.metadata,
      createdAt: now,
    };
  }

  private mapObservation(
    observation: Observation,
    assetIds: Set<string>,
    evidenceIds: Set<string>,
    now: Date,
  ) {
    return {
      id: observation.id,
      organizationId: observation.organizationId,
      scannerRunId: observation.scannerRunId,
      sourceKind: observation.sourceKind,
      sourceRuleId: observation.sourceRuleId,
      assetId:
        observation.assetRef && assetIds.has(observation.assetRef) ? observation.assetRef : null,
      status: observation.status,
      severity: observation.severity,
      title: observation.title,
      rawArtifactRef: observation.rawArtifactRef,
      evidenceRefs: observation.evidenceRefs.filter((ref) => evidenceIds.has(ref)),
      observedAt: parseDate(observation.observedAt, now),
      normalized: observation.normalized,
      createdAt: now,
    };
  }

  private mapFinding(
    finding: FindingInstance,
    assetIds: Set<string>,
    evidenceIds: Set<string>,
    now: Date,
  ) {
    return {
      id: finding.id,
      organizationId: finding.organizationId,
      scannerRunId: finding.scannerRunId,
      assetId: finding.assetRef && assetIds.has(finding.assetRef) ? finding.assetRef : null,
      findingKey: finding.findingKey,
      status: finding.status,
      severity: finding.severity,
      confidence: finding.confidence,
      firstSeenAt: parseDate(finding.firstSeenAt, now),
      lastSeenAt: parseDate(finding.lastSeenAt, now),
      observationRefs: finding.observationRefs,
      evidenceRefs: finding.evidenceRefs.filter((ref) => evidenceIds.has(ref)),
      suppressionRef: finding.suppressionRef,
      acceptedRiskRef: finding.acceptedRiskRef,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  private indexFindingsByObservation(findings: FindingInstance[]): Map<string, FindingInstance[]> {
    const index = new Map<string, FindingInstance[]>();
    for (const finding of findings) {
      for (const observationRef of finding.observationRefs) {
        const existing = index.get(observationRef) ?? [];
        existing.push(finding);
        index.set(observationRef, existing);
      }
    }
    return index;
  }

  private buildControlResults(
    batch: ShipSecIngestionBatch,
    findingsByObservation: Map<string, FindingInstance[]>,
  ): ControlResultDraft[] {
    const drafts: ControlResultDraft[] = [];
    for (const observation of batch.observations) {
      const refs = extractComplianceRefs(observation);
      if (refs.length === 0) continue;

      const relatedFindings = findingsByObservation.get(observation.id) ?? [];
      const normalized = toRecord(observation.normalized);
      const provider = typeof normalized.provider === 'string' ? normalized.provider : undefined;
      const scopeRef =
        observation.assetRef ??
        batch.scannerRun.scope.accountId ??
        batch.scannerRun.scope.projectId ??
        batch.scannerRun.scope.domain ??
        batch.scannerRun.id;

      for (const ref of refs) {
        drafts.push({
          id: `control_result_${stableHash(
            observation.organizationId,
            observation.id,
            ref.frameworkKey,
            ref.controlId,
          )}`,
          frameworkKey: ref.frameworkKey,
          controlId: ref.controlId,
          observationId: observation.id,
          findingRefs: relatedFindings.map((finding) => finding.id),
          evidenceRefs: observation.evidenceRefs,
          scopeRef,
          status: normalizeStatusForControl(observation.status),
          reason: observation.title,
          evaluatedAt: parseDate(observation.observedAt),
          metadata: {
            rawRequirement: ref.raw,
            sourceKind: observation.sourceKind,
            sourceRuleId: observation.sourceRuleId,
            provider,
          },
        });
      }
    }
    return drafts;
  }

  private buildGraphEdges(
    batch: ShipSecIngestionBatch,
    controlResults: ControlResultDraft[],
  ): GraphEdgeDraft[] {
    const edges = new Map<string, GraphEdgeDraft>();

    const addEdge = (edge: Omit<GraphEdgeDraft, 'id'>) => {
      const id = `edge_${stableHash(
        batch.organizationId,
        edge.edgeKind,
        edge.fromNodeRef,
        edge.toNodeRef,
      )}`;
      edges.set(id, { id, ...edge });
    };

    for (const finding of batch.findingInstances) {
      if (finding.assetRef) {
        addEdge({
          edgeKind: 'has_finding',
          fromNodeRef: buildNodeRef('asset', finding.assetRef),
          toNodeRef: buildNodeRef('finding_instance', finding.id),
          confidence: finding.confidence,
          evidenceRefs: finding.evidenceRefs,
          properties: { severity: finding.severity, status: finding.status },
        });
      }

      for (const evidenceRef of finding.evidenceRefs) {
        addEdge({
          edgeKind: 'has_evidence',
          fromNodeRef: buildNodeRef('finding_instance', finding.id),
          toNodeRef: buildNodeRef('evidence', evidenceRef),
          confidence: 1,
          evidenceRefs: [evidenceRef],
          properties: {},
        });
      }
    }

    for (const result of controlResults) {
      for (const findingRef of result.findingRefs) {
        addEdge({
          edgeKind: 'breaks_control',
          fromNodeRef: buildNodeRef('finding_instance', findingRef),
          toNodeRef: buildNodeRef('control_result', result.id),
          confidence: 0.9,
          evidenceRefs: result.evidenceRefs,
          properties: {
            frameworkKey: result.frameworkKey,
            controlId: result.controlId,
            status: result.status,
          },
        });
      }
    }

    return Array.from(edges.values());
  }

  private async persistComplianceRows(
    tx: DatabaseTx,
    batch: ShipSecIngestionBatch,
    controlResults: ControlResultDraft[],
    now: Date,
  ) {
    const mappingRows = new Map<string, typeof securityControlMappings.$inferInsert>();

    for (const observation of batch.observations) {
      if (!observation.sourceRuleId) continue;
      const normalized = toRecord(observation.normalized);
      const provider =
        typeof normalized.provider === 'string' && normalized.provider.trim()
          ? normalized.provider.trim()
          : 'unknown';

      for (const ref of extractComplianceRefs(observation)) {
        const key = [
          batch.organizationId,
          observation.sourceKind,
          provider,
          observation.sourceRuleId,
          ref.frameworkKey,
          ref.controlId,
        ].join('|');
        mappingRows.set(key, {
          organizationId: batch.organizationId,
          sourceKind: observation.sourceKind,
          provider,
          sourceRuleId: observation.sourceRuleId,
          frameworkKey: ref.frameworkKey,
          controlId: ref.controlId,
          controlTitle: null,
          mappingSource: 'scanner',
          confidence: 0.8,
          metadata: { rawRequirement: ref.raw },
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (mappingRows.size > 0) {
      await tx
        .insert(securityControlMappings)
        .values(Array.from(mappingRows.values()))
        .onConflictDoUpdate({
          target: [
            securityControlMappings.organizationId,
            securityControlMappings.sourceKind,
            securityControlMappings.provider,
            securityControlMappings.sourceRuleId,
            securityControlMappings.frameworkKey,
            securityControlMappings.controlId,
          ],
          set: {
            mappingSource: sql`excluded.mapping_source`,
            confidence: sql`excluded.confidence`,
            metadata: sql`excluded.metadata`,
            updatedAt: now,
          },
        });
    }

    if (controlResults.length > 0) {
      await tx
        .insert(securityControlResults)
        .values(
          controlResults.map((result) => ({
            organizationId: batch.organizationId,
            ...result,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: securityControlResults.id,
          set: {
            status: sql`excluded.status`,
            reason: sql`excluded.reason`,
            findingRefs: sql`excluded.finding_refs`,
            evidenceRefs: sql`excluded.evidence_refs`,
            metadata: sql`excluded.metadata`,
            evaluatedAt: sql`excluded.evaluated_at`,
            updatedAt: now,
          },
        });
    }

    const links = controlResults.flatMap((result) =>
      result.findingRefs.map((findingId) => ({
        organizationId: batch.organizationId,
        findingId,
        controlResultId: result.id,
        frameworkKey: result.frameworkKey,
        controlId: result.controlId,
        status: result.status,
        evidenceRefs: result.evidenceRefs,
        metadata: { observationId: result.observationId },
        createdAt: now,
      })),
    );

    if (links.length > 0) {
      await tx
        .insert(securityFindingControlLinks)
        .values(links)
        .onConflictDoUpdate({
          target: [
            securityFindingControlLinks.findingId,
            securityFindingControlLinks.frameworkKey,
            securityFindingControlLinks.controlId,
          ],
          set: {
            controlResultId: sql`excluded.control_result_id`,
            status: sql`excluded.status`,
            evidenceRefs: sql`excluded.evidence_refs`,
            metadata: sql`excluded.metadata`,
          },
        });
    }
  }
}
