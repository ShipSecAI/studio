import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withPortMeta } from '@shipsec/component-sdk';
import {
  AssetKindSchema,
  EvidenceKindSchema,
  FindingSeveritySchema,
  ProductUpdateKindSchema,
  ShipSecSourceKindSchema,
  type AssetIdentity,
  type EvidenceItem,
  type FindingInstance,
  type Observation,
  type ScannerRun,
  assetIdentitySchema,
  evidenceItemSchema,
  findingInstanceSchema,
  observationSchema,
  scannerRunSchema,
  shipsecExecutionUpdateContractName,
} from './shipsec-north-star.js';

export const shipsecIngestionBatchContractName = 'shipsec.ingestion-batch.v1';
export const shipsecCloudProwlerIngestionInputContractName =
  'shipsec.cloud.prowler-ingestion-input.v1';
export const shipsecAsmIngestionInputContractName = 'shipsec.asm.ingestion-input.v1';
export const shipsecAgentRuntimeManifestContractName = 'shipsec.agent-runtime-manifest.v1';
export const shipsecAgentTaskRequestContractName = 'shipsec.agent-task-request.v1';
export const shipsecAgentTaskResultContractName = 'shipsec.agent-task-result.v1';

const isoTimestamp = z.string().datetime({ offset: true });
const nonEmptyString = z.string().min(1);
const jsonRecord = z.record(z.string(), z.unknown());

const artifactRefSchema = z.object({
  uri: nonEmptyString,
  kind: EvidenceKindSchema.optional(),
  hash: z.string().optional(),
  contentType: z.string().optional(),
});

export const IngestionValidationStatusSchema = z.enum(['pass', 'warn', 'fail']);
export const AgentRuntimeKindSchema = z.enum(['pi_mono_docker']);
export const AgentTaskStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export const AgentTaskTriggerSchema = z.enum(['workflow', 'chat', 'review', 'retest', 'manual']);

const ingestionStatsSchema = z.object({
  rawRecordCount: z.number().int().min(0),
  assetCount: z.number().int().min(0),
  observationCount: z.number().int().min(0),
  findingInstanceCount: z.number().int().min(0),
  evidenceItemCount: z.number().int().min(0),
  passedCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  unknownCount: z.number().int().min(0),
});

export const shipsecIngestionBatchSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      sourceKind: ShipSecSourceKindSchema,
      scannerRun: scannerRunSchema(),
      assets: z.array(assetIdentitySchema()).default([]),
      observations: z.array(observationSchema()).default([]),
      findingInstances: z.array(findingInstanceSchema()).default([]),
      evidenceItems: z.array(evidenceItemSchema()).default([]),
      stats: ingestionStatsSchema,
      validation: z.object({
        status: IngestionValidationStatusSchema,
        errors: z.array(z.string()).default([]),
        warnings: z.array(z.string()).default([]),
      }),
      createdAt: isoTimestamp,
    }),
    { schemaName: shipsecIngestionBatchContractName },
  );

export type ShipSecIngestionBatch = z.infer<ReturnType<typeof shipsecIngestionBatchSchema>>;

export const cloudProwlerIngestionInputSchema = () =>
  withPortMeta(
    z.object({
      scannerRun: scannerRunSchema(),
      rawFindings: z.array(z.unknown()).default([]),
      rawArtifactUri: z.string().optional(),
      observedAt: isoTimestamp.optional(),
    }),
    { schemaName: shipsecCloudProwlerIngestionInputContractName },
  );

export type CloudProwlerIngestionInput = z.infer<
  ReturnType<typeof cloudProwlerIngestionInputSchema>
>;

export const asmIngestionInputSchema = () =>
  withPortMeta(
    z.object({
      scannerRun: scannerRunSchema(),
      dnsResults: z.array(z.unknown()).default([]),
      httpResults: z.array(z.unknown()).default([]),
      portResults: z.array(z.unknown()).default([]),
      nucleiResults: z.array(z.unknown()).default([]),
      rawArtifactUri: z.string().optional(),
      observedAt: isoTimestamp.optional(),
    }),
    { schemaName: shipsecAsmIngestionInputContractName },
  );

export type AsmIngestionInput = z.infer<ReturnType<typeof asmIngestionInputSchema>>;

export const agentRuntimeManifestSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      runtimeKind: AgentRuntimeKindSchema.default('pi_mono_docker'),
      image: nonEmptyString,
      version: z.string().optional(),
      toolbeltRefs: z.array(nonEmptyString).default([]),
      skillRefs: z.array(nonEmptyString).default([]),
      workflowRefs: z.array(nonEmptyString).default([]),
      memoryAllowed: z.boolean().default(true),
      outputContracts: z
        .array(nonEmptyString)
        .default([shipsecAgentTaskResultContractName, shipsecExecutionUpdateContractName]),
      environment: jsonRecord.default({}),
    }),
    { schemaName: shipsecAgentRuntimeManifestContractName },
  );

export type AgentRuntimeManifest = z.infer<ReturnType<typeof agentRuntimeManifestSchema>>;

export const agentTaskRequestSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      runtimeManifestRef: nonEmptyString,
      trigger: AgentTaskTriggerSchema,
      skillRef: nonEmptyString.optional(),
      workflowRef: nonEmptyString.optional(),
      objective: nonEmptyString,
      inputRefs: z.array(nonEmptyString).default([]),
      evidenceRefs: z.array(nonEmptyString).default([]),
      memoryContextRefs: z.array(nonEmptyString).default([]),
      deterministicContext: jsonRecord.default({}),
      requestedAt: isoTimestamp,
      createdBy: z.string().optional(),
    }),
    { schemaName: shipsecAgentTaskRequestContractName },
  );

export type AgentTaskRequest = z.infer<ReturnType<typeof agentTaskRequestSchema>>;

export const agentTaskResultSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      taskRequestId: nonEmptyString,
      status: AgentTaskStatusSchema,
      summary: z.string().optional(),
      productUpdates: z
        .array(
          z.object({
            kind: ProductUpdateKindSchema,
            targetRef: nonEmptyString,
            evidenceRefs: z.array(nonEmptyString).default([]),
            summary: nonEmptyString,
          }),
        )
        .default([]),
      artifactRefs: z.array(artifactRefSchema).default([]),
      evidenceRefs: z.array(nonEmptyString).default([]),
      errors: z.array(z.string()).default([]),
      startedAt: isoTimestamp.optional(),
      completedAt: isoTimestamp.optional(),
    }),
    { schemaName: shipsecAgentTaskResultContractName },
  );

export type AgentTaskResult = z.infer<ReturnType<typeof agentTaskResultSchema>>;

function stableHash(...parts: unknown[]): string {
  const normalized = parts
    .map((part) => {
      if (part == null) return '';
      if (typeof part === 'string') return part.trim().toLowerCase();
      return JSON.stringify(part);
    })
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

function stableId(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${stableHash(...parts)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[key]);
}

function getArray(value: unknown, key: string): unknown[] {
  const record = asRecord(value);
  const child = record?.[key];
  return Array.isArray(child) ? child : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function normalizeKeyPart(value: string | undefined, fallback = 'unknown'): string {
  return (value?.trim().toLowerCase().replace(/\s+/g, '-') || fallback).replace(/[|]/g, '-');
}

function uniqueStrings(values: (string | undefined | null)[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function flattenSourceValues(values: unknown[], warnings: string[], label: string): unknown[] {
  const flattened: unknown[] = [];
  values.forEach((value, index) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      flattened.push(...flattenSourceValues(value, warnings, label));
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      try {
        const parsed = JSON.parse(trimmed);
        flattened.push(...flattenSourceValues([parsed], warnings, label));
        return;
      } catch {
        const records: unknown[] = [];
        for (const [lineIndex, line] of trimmed.split(/\r?\n/).entries()) {
          const candidate = line.trim();
          if (candidate.length === 0) continue;
          try {
            records.push(JSON.parse(candidate));
          } catch {
            warnings.push(`${label}[${index}] line ${lineIndex + 1} is not valid JSON.`);
          }
        }
        flattened.push(...records);
        return;
      }
    }
    const record = asRecord(value);
    if (record?.rawFinding && asRecord(record.rawFinding)) {
      flattened.push(record.rawFinding);
      return;
    }
    if (Array.isArray(record?.Findings)) {
      flattened.push(...record.Findings);
      return;
    }
    if (Array.isArray(record?.findings)) {
      flattened.push(...record.findings);
      return;
    }
    flattened.push(value);
  });
  return flattened;
}

function toShipSecSeverity(
  value: unknown,
  severityId?: unknown,
): z.infer<typeof FindingSeveritySchema> {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text.startsWith('crit')) return 'critical';
  if (text.startsWith('high')) return 'high';
  if (text.startsWith('med')) return 'medium';
  if (text.startsWith('low')) return 'low';
  if (text.startsWith('info') || text === 'informational') return 'info';
  if (typeof severityId === 'number' && Number.isFinite(severityId)) {
    if (severityId >= 5) return 'critical';
    if (severityId === 4) return 'high';
    if (severityId === 3) return 'medium';
    if (severityId === 2) return 'low';
    if (severityId === 1) return 'info';
  }
  return 'unknown';
}

function toCloudSeverity(record: Record<string, unknown>): z.infer<typeof FindingSeveritySchema> {
  const severity = asRecord(record.Severity);
  const normalizedScore = severity?.Normalized;
  if (typeof normalizedScore === 'number' && Number.isFinite(normalizedScore)) {
    if (normalizedScore >= 90) return 'critical';
    if (normalizedScore >= 70) return 'high';
    if (normalizedScore >= 40) return 'medium';
    if (normalizedScore >= 1) return 'low';
    return 'info';
  }
  return toShipSecSeverity(
    firstString(severity?.Label, severity?.Original, record.severity),
    record.severity_id,
  );
}

function normalizeStatus(value: unknown): string {
  const text = firstString(value)?.toUpperCase() ?? 'UNKNOWN';
  if (text.includes('FAIL')) return 'FAILED';
  if (text.includes('PASS')) return 'PASSED';
  if (text.includes('WARN')) return 'WARNING';
  if (text.includes('NOT_APPLICABLE') || text === 'NOTAPPLICABLE') return 'NOT_APPLICABLE';
  if (text.includes('NOT_AVAILABLE') || text === 'NOTAVAILABLE') return 'NOT_AVAILABLE';
  if (text.includes('OPEN')) return 'OPEN';
  if (text.includes('MATCH')) return 'MATCHED';
  return text;
}

function shouldCreateFinding(
  status: string,
  severity: z.infer<typeof FindingSeveritySchema>,
): boolean {
  return (
    status === 'FAILED' ||
    status === 'WARNING' ||
    status === 'OPEN' ||
    status === 'MATCHED' ||
    severity === 'critical' ||
    severity === 'high' ||
    severity === 'medium' ||
    severity === 'low'
  );
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
  const record = asRecord(value);
  if (record) {
    for (const item of Object.values(record)) collectStrings(item, output);
  }
  return output;
}

function extractServiceName(resourceType?: string, resourceId?: string): string | undefined {
  const type = resourceType?.replace(/^Aws/, '').trim();
  if (type) return type;
  const arnMatch = resourceId?.match(/^arn:[^:]*:([^:]+):/);
  return arnMatch?.[1];
}

function extractRegionFromArn(resourceId?: string): string | undefined {
  const region = resourceId?.match(/^arn:[^:]*:[^:]*:([^:]*):/)?.[1];
  return region && region !== '*' ? region : undefined;
}

function extractAccountIdFromArn(resourceId?: string): string | undefined {
  return resourceId?.match(/^arn:[^:]*:[^:]*:[^:]*:(\d{12}):/)?.[1];
}

interface ExtractedCloudFinding {
  raw: Record<string, unknown>;
  checkId: string;
  title: string;
  description?: string;
  provider: string;
  accountId?: string;
  projectId?: string;
  region?: string;
  resourceId?: string;
  resourceType?: string;
  serviceName?: string;
  status: string;
  severity: z.infer<typeof FindingSeveritySchema>;
  remediationText?: string;
  recommendationUrl?: string;
  compliance: string[];
}

function extractCloudFinding(
  rawValue: unknown,
  index: number,
  scannerRun: ScannerRun,
): ExtractedCloudFinding | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;

  const asffResource = getArray(raw, 'Resources').map(asRecord).find(Boolean) ?? null;
  const ocsfResource = getArray(raw, 'resources').map(asRecord).find(Boolean) ?? null;
  const resource = asffResource ?? ocsfResource;
  const cloud = getRecord(raw, 'cloud');
  const account = getRecord(cloud, 'account');
  const findingInfo = getRecord(raw, 'finding_info');
  const metadata = getRecord(raw, 'metadata');
  const severity = getRecord(raw, 'Severity');
  const compliance = getRecord(raw, 'Compliance') ?? getRecord(raw, 'compliance');
  const remediation = getRecord(raw, 'Remediation') ?? getRecord(raw, 'remediation');
  const recommendation = getRecord(remediation, 'Recommendation');

  const resourceId = firstString(resource?.Id, resource?.uid, resource?.name);
  const provider = normalizeKeyPart(
    firstString(cloud?.provider, scannerRun.scope.provider) ??
      (resourceId?.startsWith('arn:aws:') ? 'aws' : undefined),
  );
  const accountId = firstString(
    raw.AwsAccountId,
    account?.uid,
    scannerRun.scope.accountId,
    extractAccountIdFromArn(resourceId),
  );
  const projectId = firstString(account?.uid, scannerRun.scope.projectId);
  const region = firstString(
    resource?.Region,
    resource?.region,
    cloud?.region,
    scannerRun.scope.labels?.region,
    extractRegionFromArn(resourceId),
  );
  const resourceType = firstString(resource?.Type, resource?.type);
  const serviceName =
    firstString(getRecord(resource, 'group')?.name) ?? extractServiceName(resourceType, resourceId);
  const checkId =
    firstString(raw.Id, metadata?.event_code, findingInfo?.uid) ??
    `${scannerRun.id}-cloud-${index + 1}`;
  const title = firstString(raw.Title, findingInfo?.title, raw.message, checkId) ?? checkId;
  const status = normalizeStatus(firstString(compliance?.Status, raw.status_code, raw.status));

  return {
    raw,
    checkId,
    title,
    description: firstString(
      raw.Description,
      findingInfo?.desc,
      raw.risk_details,
      raw.status_detail,
    ),
    provider,
    accountId,
    projectId,
    region,
    resourceId: resourceId ?? accountId ?? projectId,
    resourceType,
    serviceName,
    status,
    severity: toCloudSeverity(raw),
    remediationText: firstString(recommendation?.Text, remediation?.desc),
    recommendationUrl:
      firstString(recommendation?.Url) ??
      getArray(remediation, 'references').map(firstString).find(Boolean),
    compliance: uniqueStrings(collectStrings(compliance)),
  };
}

function buildEvidence(
  organizationId: string,
  sourceKind: z.infer<typeof ShipSecSourceKindSchema>,
  scannerRunId: string,
  artifactUri: string,
  observedAt: string,
  summary: string,
  metadata: Record<string, unknown>,
): EvidenceItem {
  return evidenceItemSchema().parse({
    id: stableId('evidence', organizationId, scannerRunId, artifactUri, summary),
    organizationId,
    kind: 'raw_scanner_output',
    sourceKind,
    scannerRunId,
    artifactUri,
    summary,
    capturedAt: observedAt,
    retentionClass: 'audit',
    metadata,
  });
}

function buildCloudAsset(
  scannerRun: ScannerRun,
  finding: ExtractedCloudFinding,
  observedAt: string,
): AssetIdentity {
  const accountOrProject = finding.accountId ?? finding.projectId ?? 'unknown';
  const nativeId = finding.resourceId ?? accountOrProject;
  const stableKey = [
    'cloud',
    normalizeKeyPart(finding.provider),
    normalizeKeyPart(accountOrProject),
    normalizeKeyPart(finding.region, 'global'),
    nativeId,
  ].join(':');

  return assetIdentitySchema().parse({
    id: stableId('asset', scannerRun.organizationId, stableKey),
    organizationId: scannerRun.organizationId,
    assetKind: nativeId === accountOrProject ? 'cloud_account' : 'cloud_resource',
    provider: finding.provider,
    nativeId,
    stableKey,
    displayName: nativeId,
    aliases: uniqueStrings([nativeId, finding.resourceId, finding.accountId, finding.projectId]),
    confidence: 'deterministic',
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    metadata: {
      accountId: finding.accountId,
      projectId: finding.projectId,
      region: finding.region,
      resourceType: finding.resourceType,
      serviceName: finding.serviceName,
      scope: scannerRun.scope,
    },
  });
}

function countStatus(stats: MutableStats, status: string): void {
  if (status === 'FAILED' || status === 'OPEN' || status === 'MATCHED') {
    stats.failedCount += 1;
    return;
  }
  if (status === 'PASSED') {
    stats.passedCount += 1;
    return;
  }
  if (status === 'WARNING') {
    stats.warningCount += 1;
    return;
  }
  stats.unknownCount += 1;
}

interface MutableStats {
  rawRecordCount: number;
  assetCount: number;
  observationCount: number;
  findingInstanceCount: number;
  evidenceItemCount: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
  unknownCount: number;
}

function createStats(rawRecordCount: number): MutableStats {
  return {
    rawRecordCount,
    assetCount: 0,
    observationCount: 0,
    findingInstanceCount: 0,
    evidenceItemCount: 0,
    passedCount: 0,
    failedCount: 0,
    warningCount: 0,
    unknownCount: 0,
  };
}

export function normalizeProwlerCloudIngestion(
  input: CloudProwlerIngestionInput,
): ShipSecIngestionBatch {
  const parsed = cloudProwlerIngestionInputSchema().parse(input);
  const scannerRun = scannerRunSchema().parse(parsed.scannerRun);
  const observedAt = parsed.observedAt ?? scannerRun.completedAt ?? new Date().toISOString();
  const warnings: string[] = [];
  const rawRecords = flattenSourceValues(parsed.rawFindings, warnings, 'rawFindings');
  const stats = createStats(rawRecords.length);
  const assetByKey = new Map<string, AssetIdentity>();
  const observations: Observation[] = [];
  const findingInstances: FindingInstance[] = [];
  const evidenceItems: EvidenceItem[] = [];

  rawRecords.forEach((raw, index) => {
    const extracted = extractCloudFinding(raw, index, scannerRun);
    if (!extracted) {
      warnings.push(`rawFindings[${index}] was not an object and was skipped.`);
      stats.unknownCount += 1;
      return;
    }

    const asset = buildCloudAsset(scannerRun, extracted, observedAt);
    assetByKey.set(asset.stableKey, asset);

    const artifactUri =
      parsed.rawArtifactUri ??
      scannerRun.artifactRefs[0]?.uri ??
      `memory://${scannerRun.id}/prowler/${index + 1}`;
    const evidence = buildEvidence(
      scannerRun.organizationId,
      'prowler',
      scannerRun.id,
      artifactUri,
      observedAt,
      `Prowler ${extracted.checkId} on ${asset.displayName}`,
      {
        checkId: extracted.checkId,
        provider: extracted.provider,
        accountId: extracted.accountId,
        region: extracted.region,
      },
    );
    evidenceItems.push(evidence);

    const observation = observationSchema().parse({
      id: stableId(
        'obs',
        scannerRun.organizationId,
        scannerRun.id,
        extracted.checkId,
        asset.stableKey,
        extracted.status,
      ),
      organizationId: scannerRun.organizationId,
      scannerRunId: scannerRun.id,
      sourceKind: 'prowler',
      sourceRuleId: extracted.checkId,
      assetRef: asset.id,
      status: extracted.status,
      severity: extracted.severity,
      title: extracted.title,
      rawArtifactRef: { uri: artifactUri, kind: 'raw_scanner_output' },
      evidenceRefs: [evidence.id],
      observedAt,
      normalized: {
        provider: extracted.provider,
        accountId: extracted.accountId,
        projectId: extracted.projectId,
        region: extracted.region,
        resourceId: extracted.resourceId,
        resourceType: extracted.resourceType,
        serviceName: extracted.serviceName,
        compliance: extracted.compliance,
        remediationText: extracted.remediationText,
        recommendationUrl: extracted.recommendationUrl,
        rawFinding: extracted.raw,
      },
    });
    observations.push(observation);
    countStatus(stats, extracted.status);

    if (shouldCreateFinding(extracted.status, extracted.severity)) {
      findingInstances.push(
        findingInstanceSchema().parse({
          id: stableId('finding', scannerRun.organizationId, extracted.checkId, asset.stableKey),
          organizationId: scannerRun.organizationId,
          scannerRunId: scannerRun.id,
          observationRefs: [observation.id],
          assetRef: asset.id,
          findingKey: `cloud:${extracted.provider}:${extracted.checkId}:${asset.stableKey}`,
          status: 'open',
          severity: extracted.severity,
          confidence: 1,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          evidenceRefs: [evidence.id],
        }),
      );
    }
  });

  stats.assetCount = assetByKey.size;
  stats.observationCount = observations.length;
  stats.findingInstanceCount = findingInstances.length;
  stats.evidenceItemCount = evidenceItems.length;

  return shipsecIngestionBatchSchema().parse({
    id: stableId('ingest', scannerRun.organizationId, scannerRun.id, 'prowler'),
    organizationId: scannerRun.organizationId,
    sourceKind: 'prowler',
    scannerRun,
    assets: Array.from(assetByKey.values()),
    observations,
    findingInstances,
    evidenceItems,
    stats,
    validation: {
      status: warnings.length > 0 ? 'warn' : 'pass',
      errors: [],
      warnings,
    },
    createdAt: observedAt,
  });
}

function normalizeHost(value: unknown): string | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    try {
      return new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return raw.split('/')[0]?.trim().toLowerCase().replace(/\.$/, '') || undefined;
    }
  }
}

function extractUrl(value: unknown): URL | null {
  const raw = firstString(value);
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function numericPort(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function defaultPortForScheme(scheme?: string): number | undefined {
  if (scheme === 'https') return 443;
  if (scheme === 'http') return 80;
  return undefined;
}

const riskyPorts = new Set([21, 22, 23, 3389, 5432, 3306, 6379, 9200, 9300, 27017, 11211, 5900]);

interface AsmExtractedRecord {
  raw: Record<string, unknown>;
  sourceKind: z.infer<typeof ShipSecSourceKindSchema>;
  sourceRuleId: string;
  assetKind: z.infer<typeof AssetKindSchema>;
  stableKey: string;
  displayName: string;
  aliases: string[];
  title: string;
  status: string;
  severity: z.infer<typeof FindingSeveritySchema>;
  createFinding: boolean;
  metadata: Record<string, unknown>;
}

function extractAsmRecord(
  rawValue: unknown,
  family: 'dns' | 'http' | 'port' | 'nuclei',
  index: number,
): AsmExtractedRecord | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;

  const matchedUrl = extractUrl(raw.matchedAt ?? raw['matched-at'] ?? raw.url);
  const host =
    normalizeHost(raw.host ?? raw.hostname ?? raw.domain ?? raw.subdomain ?? raw.asset_key) ??
    normalizeHost(matchedUrl?.hostname) ??
    normalizeHost(raw.input ?? raw.target);
  const ip = firstString(raw.ip);
  const scheme = firstString(raw.scheme, matchedUrl?.protocol.replace(':', ''));
  const port =
    numericPort(raw.port) ?? numericPort(matchedUrl?.port) ?? defaultPortForScheme(scheme);
  const protocol =
    firstString(raw.protocol, scheme, port === 443 ? 'https' : port === 80 ? 'http' : 'tcp') ??
    'tcp';
  const templateId = firstString(raw.templateId, raw['template-id'], raw.template_id);

  if (!host && !ip) return null;

  if (family === 'port') {
    const portNumber = port;
    if (!portNumber) return null;
    const target = host ?? ip ?? 'unknown';
    const severity: z.infer<typeof FindingSeveritySchema> = riskyPorts.has(portNumber)
      ? portNumber === 3389 || portNumber === 6379 || portNumber === 9200 || portNumber === 27017
        ? 'high'
        : 'medium'
      : 'info';
    return {
      raw,
      sourceKind: 'asm',
      sourceRuleId: 'asm.open_port',
      assetKind: 'port',
      stableKey: `asm:port:${normalizeKeyPart(target)}:${portNumber}/${normalizeKeyPart(protocol)}`,
      displayName: `${target}:${portNumber}/${protocol}`,
      aliases: uniqueStrings([target, ip, host]),
      title: `Open ${protocol.toUpperCase()} port ${portNumber}`,
      status: 'OPEN',
      severity,
      createFinding: riskyPorts.has(portNumber),
      metadata: { host, ip, port: portNumber, protocol, raw },
    };
  }

  if (family === 'http') {
    const target = host ?? ip ?? 'unknown';
    const portNumber = port ?? defaultPortForScheme(scheme);
    const statusCode = numericPort(raw.status_code ?? raw.statusCode);
    const title = firstString(raw.title);
    return {
      raw,
      sourceKind: 'asm',
      sourceRuleId: 'asm.http_service',
      assetKind: 'http_service',
      stableKey: `asm:http_service:${normalizeKeyPart(scheme, 'http')}:${normalizeKeyPart(target)}:${portNumber ?? 'unknown'}`,
      displayName:
        firstString(raw.url, matchedUrl?.toString()) ?? `${target}:${portNumber ?? 'unknown'}`,
      aliases: uniqueStrings([target, ip, host, firstString(raw.url)]),
      title: title ? `HTTP service: ${title}` : 'HTTP service discovered',
      status: 'DISCOVERED',
      severity: 'info',
      createFinding: false,
      metadata: {
        host,
        ip,
        scheme,
        port: portNumber,
        statusCode,
        title,
        url: firstString(raw.url, matchedUrl?.toString()),
        technologies: Array.isArray(raw.technologies) ? raw.technologies : [],
        raw,
      },
    };
  }

  if (family === 'nuclei') {
    const target = host ?? ip ?? 'unknown';
    const portNumber = port ?? defaultPortForScheme(scheme);
    const severity = toShipSecSeverity(firstString(raw.severity, getRecord(raw, 'info')?.severity));
    return {
      raw,
      sourceKind: 'nuclei',
      sourceRuleId: templateId ?? `nuclei.${index + 1}`,
      assetKind: 'http_service',
      stableKey: `asm:http_service:${normalizeKeyPart(scheme, 'http')}:${normalizeKeyPart(target)}:${portNumber ?? 'unknown'}`,
      displayName: firstString(raw.matchedAt, raw.url, target) ?? target,
      aliases: uniqueStrings([target, ip, host, firstString(raw.matchedAt, raw.url)]),
      title:
        firstString(raw.name, getRecord(raw, 'info')?.name, templateId) ??
        `Nuclei finding ${index + 1}`,
      status: 'MATCHED',
      severity,
      createFinding: severity !== 'info' && severity !== 'unknown',
      metadata: {
        host,
        ip,
        scheme,
        port: portNumber,
        templateId,
        matchedAt: firstString(raw.matchedAt, raw['matched-at']),
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        raw,
      },
    };
  }

  const target = host ?? ip ?? 'unknown';
  return {
    raw,
    sourceKind: 'asm',
    sourceRuleId: 'asm.dns_resolution',
    assetKind: host ? 'host' : 'ip',
    stableKey: host ? `asm:host:${normalizeKeyPart(host)}` : `asm:ip:${normalizeKeyPart(ip)}`,
    displayName: target,
    aliases: uniqueStrings([target, ip, host]),
    title: 'DNS asset discovered',
    status: 'DISCOVERED',
    severity: 'info',
    createFinding: false,
    metadata: {
      host,
      ip,
      answers: raw.answers,
      dnsRecords: raw.dnsRecords ?? raw.dns_records,
      raw,
    },
  };
}

function buildAsmAsset(
  scannerRun: ScannerRun,
  record: AsmExtractedRecord,
  observedAt: string,
): AssetIdentity {
  return assetIdentitySchema().parse({
    id: stableId('asset', scannerRun.organizationId, record.stableKey),
    organizationId: scannerRun.organizationId,
    assetKind: record.assetKind,
    provider: 'asm',
    nativeId: record.displayName,
    stableKey: record.stableKey,
    displayName: record.displayName,
    aliases: record.aliases,
    confidence: 'deterministic',
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    metadata: record.metadata,
  });
}

export function normalizeAsmIngestion(input: AsmIngestionInput): ShipSecIngestionBatch {
  const parsed = asmIngestionInputSchema().parse(input);
  const scannerRun = scannerRunSchema().parse(parsed.scannerRun);
  const observedAt = parsed.observedAt ?? scannerRun.completedAt ?? new Date().toISOString();
  const warnings: string[] = [];
  const sourceGroups = [
    { family: 'dns' as const, values: parsed.dnsResults },
    { family: 'http' as const, values: parsed.httpResults },
    { family: 'port' as const, values: parsed.portResults },
    { family: 'nuclei' as const, values: parsed.nucleiResults },
  ];
  const flattened = sourceGroups.flatMap((group) =>
    flattenSourceValues(group.values, warnings, group.family).map((value) => ({
      family: group.family,
      value,
    })),
  );
  const stats = createStats(flattened.length);
  const assetByKey = new Map<string, AssetIdentity>();
  const observations: Observation[] = [];
  const findingInstances: FindingInstance[] = [];
  const evidenceItems: EvidenceItem[] = [];

  flattened.forEach((entry, index) => {
    const extracted = extractAsmRecord(entry.value, entry.family, index);
    if (!extracted) {
      warnings.push(`${entry.family}[${index}] could not be mapped to an ASM asset.`);
      stats.unknownCount += 1;
      return;
    }

    const asset = buildAsmAsset(scannerRun, extracted, observedAt);
    assetByKey.set(asset.stableKey, asset);

    const artifactUri =
      parsed.rawArtifactUri ??
      scannerRun.artifactRefs[0]?.uri ??
      `memory://${scannerRun.id}/asm/${entry.family}/${index + 1}`;
    const evidence = buildEvidence(
      scannerRun.organizationId,
      extracted.sourceKind,
      scannerRun.id,
      artifactUri,
      observedAt,
      `${extracted.sourceRuleId} evidence for ${asset.displayName}`,
      {
        sourceRuleId: extracted.sourceRuleId,
        family: entry.family,
        stableKey: asset.stableKey,
      },
    );
    evidenceItems.push(evidence);

    const observation = observationSchema().parse({
      id: stableId(
        'obs',
        scannerRun.organizationId,
        scannerRun.id,
        extracted.sourceRuleId,
        asset.stableKey,
        extracted.status,
      ),
      organizationId: scannerRun.organizationId,
      scannerRunId: scannerRun.id,
      sourceKind: extracted.sourceKind,
      sourceRuleId: extracted.sourceRuleId,
      assetRef: asset.id,
      status: extracted.status,
      severity: extracted.severity,
      title: extracted.title,
      rawArtifactRef: { uri: artifactUri, kind: 'raw_scanner_output' },
      evidenceRefs: [evidence.id],
      observedAt,
      normalized: extracted.metadata,
    });
    observations.push(observation);
    countStatus(stats, extracted.status);

    if (extracted.createFinding) {
      findingInstances.push(
        findingInstanceSchema().parse({
          id: stableId(
            'finding',
            scannerRun.organizationId,
            extracted.sourceRuleId,
            asset.stableKey,
          ),
          organizationId: scannerRun.organizationId,
          scannerRunId: scannerRun.id,
          observationRefs: [observation.id],
          assetRef: asset.id,
          findingKey: `asm:${extracted.sourceRuleId}:${asset.stableKey}`,
          status: 'open',
          severity: extracted.severity,
          confidence: 1,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          evidenceRefs: [evidence.id],
        }),
      );
    }
  });

  stats.assetCount = assetByKey.size;
  stats.observationCount = observations.length;
  stats.findingInstanceCount = findingInstances.length;
  stats.evidenceItemCount = evidenceItems.length;

  return shipsecIngestionBatchSchema().parse({
    id: stableId('ingest', scannerRun.organizationId, scannerRun.id, 'asm'),
    organizationId: scannerRun.organizationId,
    sourceKind: 'asm',
    scannerRun,
    assets: Array.from(assetByKey.values()),
    observations,
    findingInstances,
    evidenceItems,
    stats,
    validation: {
      status: warnings.length > 0 ? 'warn' : 'pass',
      errors: [],
      warnings,
    },
    createdAt: observedAt,
  });
}

export function validateShipSecIngestionBatch(batch: unknown): {
  status: z.infer<typeof IngestionValidationStatusSchema>;
  errors: string[];
  warnings: string[];
} {
  const parsed = shipsecIngestionBatchSchema().safeParse(batch);
  if (!parsed.success) {
    return {
      status: 'fail',
      errors: [parsed.error.message],
      warnings: [],
    };
  }
  return parsed.data.validation;
}
