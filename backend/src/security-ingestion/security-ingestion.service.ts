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
  securityGraphEdges,
  securityIngestionBatches,
  securityObservations,
  securityScannerRuns,
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
