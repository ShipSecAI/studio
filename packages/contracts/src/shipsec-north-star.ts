import { z } from 'zod';
import { withPortMeta } from '@shipsec/component-sdk';

export const shipsecNorthStarContractName = 'shipsec.north-star.v1';
export const shipsecScannerRunContractName = 'shipsec.scanner-run.v1';
export const shipsecAssetIdentityContractName = 'shipsec.asset-identity.v1';
export const shipsecObservationContractName = 'shipsec.observation.v1';
export const shipsecFindingInstanceContractName = 'shipsec.finding-instance.v1';
export const shipsecFindingClusterContractName = 'shipsec.finding-cluster.v1';
export const shipsecEvidenceItemContractName = 'shipsec.evidence-item.v1';
export const shipsecComplianceControlContractName = 'shipsec.compliance-control.v1';
export const shipsecControlResultContractName = 'shipsec.control-result.v1';
export const shipsecGraphNodeContractName = 'shipsec.graph-node.v1';
export const shipsecGraphEdgeContractName = 'shipsec.graph-edge.v1';
export const shipsecAgentMemoryContextContractName = 'shipsec.agent-memory-context.v1';
export const shipsecExecutionUpdateContractName = 'shipsec.execution-update.v1';

const isoTimestamp = z.string().datetime({ offset: true });
const nonEmptyString = z.string().min(1);
const stringRecord = z.record(z.string(), z.string());
const jsonRecord = z.record(z.string(), z.unknown());

export const ShipSecProductSurfaceSchema = z.enum([
  'findings',
  'compliance',
  'map',
  'execution_plane',
]);

export const ShipSecSourceKindSchema = z.enum([
  'prowler',
  'opengrep',
  'trivy',
  'trufflehog',
  'dependency_scanner',
  'nuclei',
  'asm',
  'ai_code_review',
  'architecture_facts',
  'manual',
]);

export const ScannerRunTriggerKindSchema = z.enum([
  'manual',
  'scheduled',
  'webhook',
  'workflow',
  'retest',
]);

export const ScannerRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const AssetKindSchema = z.enum([
  'cloud_account',
  'cloud_resource',
  'repository',
  'service',
  'package',
  'file',
  'api_route',
  'domain',
  'host',
  'ip',
  'port',
  'http_service',
  'certificate',
  'iam_principal',
  'iam_role',
  'iam_policy',
  'data_store',
  'secret',
  'queue',
  'topic',
  'container_image',
  'deployment',
]);

export const AssetIdentityConfidenceSchema = z.enum([
  'deterministic',
  'inferred_high',
  'inferred_medium',
  'candidate',
]);

export const FindingStatusSchema = z.enum([
  'open',
  'in_progress',
  'suppressed',
  'accepted_risk',
  'fixed',
  'reopened',
  'false_positive',
]);

export const FindingSeveritySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'unknown',
]);

export const ControlStatusSchema = z.enum([
  'pass',
  'fail',
  'warn',
  'unknown',
  'accepted',
]);

export const ComplianceFrameworkSchema = z.enum([
  'soc2',
  'iso27001',
  'pci',
  'hipaa',
  'cis',
  'nist',
  'custom',
]);

export const EvidenceKindSchema = z.enum([
  'raw_scanner_output',
  'normalized_observation',
  'code_snippet',
  'log_excerpt',
  'screenshot',
  'graph_query',
  'agent_output',
  'manual_attestation',
  'ticket',
  'pull_request',
]);

export const GraphNodeKindSchema = z.enum([
  'asset',
  'finding_instance',
  'finding_cluster',
  'control',
  'control_result',
  'evidence',
  'owner',
  'team',
  'scanner_run',
]);

export const GraphEdgeKindSchema = z.enum([
  'owns',
  'deployed_as',
  'exposes',
  'calls',
  'depends_on',
  'stores',
  'reads',
  'writes',
  'has_finding',
  'belongs_to_cluster',
  'breaks_control',
  'has_evidence',
  'reachable_from',
  'assumes',
  'grants',
  'internet_exposed',
]);

export const AgentMemoryKindSchema = z.enum([
  'user_preference',
  'organization_convention',
  'false_positive_history',
  'owner_convention',
  'accepted_risk_pattern',
  'remediation_style',
]);

export const ProductUpdateKindSchema = z.enum([
  'finding',
  'cluster',
  'control_result',
  'asset',
  'graph_edge',
  'evidence_item',
  'ticket',
  'remediation_plan',
]);

const artifactRefSchema = z.object({
  uri: nonEmptyString,
  kind: EvidenceKindSchema.optional(),
  hash: z.string().optional(),
  contentType: z.string().optional(),
});

const scopeSchema = z.object({
  organizationId: nonEmptyString,
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  provider: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  domain: z.string().optional(),
  labels: stringRecord.optional(),
});

export const shipsecNorthStarSchema = () =>
  withPortMeta(
    z.object({
      version: z.literal('v1'),
      surfaces: z.array(ShipSecProductSurfaceSchema).default([
        'findings',
        'compliance',
        'map',
        'execution_plane',
      ]),
      invariants: z.object({
        findingsHaveSecurityAndComplianceAngles: z.boolean(),
        controlsLinkToEvidenceAndFindings: z.boolean(),
        mapShowsInfraCodeAsmAndIssues: z.boolean(),
        agentOutputsRequireDeterministicEvidence: z.boolean(),
      }),
    }),
    { schemaName: shipsecNorthStarContractName },
  );

export type ShipSecNorthStar = z.infer<ReturnType<typeof shipsecNorthStarSchema>>;

export const scannerRunSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      sourceKind: ShipSecSourceKindSchema,
      sourceVersion: z.string().optional(),
      scope: scopeSchema,
      triggerKind: ScannerRunTriggerKindSchema,
      status: ScannerRunStatusSchema,
      startedAt: isoTimestamp,
      completedAt: isoTimestamp.optional(),
      parentRunId: z.string().optional(),
      artifactRefs: z.array(artifactRefSchema).default([]),
      configHash: z.string().optional(),
      workflowId: z.string().optional(),
      runId: z.string().optional(),
      nodeRef: z.string().optional(),
      createdBy: z.string().optional(),
    }),
    { schemaName: shipsecScannerRunContractName },
  );

export type ScannerRun = z.infer<ReturnType<typeof scannerRunSchema>>;

export const assetIdentitySchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      assetKind: AssetKindSchema,
      provider: z.string().optional(),
      nativeId: z.string().optional(),
      stableKey: nonEmptyString,
      displayName: nonEmptyString,
      aliases: z.array(nonEmptyString).default([]),
      confidence: AssetIdentityConfidenceSchema,
      ownerRef: z.string().optional(),
      environment: z.string().optional(),
      criticality: z.enum(['critical', 'high', 'medium', 'low', 'unknown']).default('unknown'),
      firstSeenAt: isoTimestamp.optional(),
      lastSeenAt: isoTimestamp.optional(),
      metadata: jsonRecord.default({}),
    }),
    { schemaName: shipsecAssetIdentityContractName },
  );

export type AssetIdentity = z.infer<ReturnType<typeof assetIdentitySchema>>;

export const observationSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      scannerRunId: nonEmptyString,
      sourceKind: ShipSecSourceKindSchema,
      sourceRuleId: z.string().optional(),
      assetRef: z.string().optional(),
      status: z.string().optional(),
      severity: FindingSeveritySchema.default('unknown'),
      title: nonEmptyString,
      rawArtifactRef: artifactRefSchema.optional(),
      evidenceRefs: z.array(nonEmptyString).default([]),
      observedAt: isoTimestamp,
      normalized: jsonRecord.default({}),
    }),
    { schemaName: shipsecObservationContractName },
  );

export type Observation = z.infer<ReturnType<typeof observationSchema>>;

export const findingInstanceSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      scannerRunId: nonEmptyString,
      observationRefs: z.array(nonEmptyString).default([]),
      assetRef: z.string().optional(),
      findingKey: nonEmptyString,
      status: FindingStatusSchema,
      severity: FindingSeveritySchema,
      confidence: z.number().min(0).max(1).default(1),
      firstSeenAt: isoTimestamp,
      lastSeenAt: isoTimestamp,
      suppressionRef: z.string().optional(),
      acceptedRiskRef: z.string().optional(),
      evidenceRefs: z.array(nonEmptyString).default([]),
    }),
    { schemaName: shipsecFindingInstanceContractName },
  );

export type FindingInstance = z.infer<ReturnType<typeof findingInstanceSchema>>;

export const findingClusterSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      title: nonEmptyString,
      summary: nonEmptyString,
      rootCause: z.string().optional(),
      priority: z.enum(['p0', 'p1', 'p2', 'p3', 'p4']).default('p3'),
      severity: FindingSeveritySchema,
      confidence: z.number().min(0).max(1).default(1),
      findingInstanceRefs: z.array(nonEmptyString).default([]),
      assetRefs: z.array(nonEmptyString).default([]),
      ownerRef: z.string().optional(),
      controlResultRefs: z.array(nonEmptyString).default([]),
      evidenceRefs: z.array(nonEmptyString).default([]),
      graphQueryRefs: z.array(nonEmptyString).default([]),
    }),
    { schemaName: shipsecFindingClusterContractName },
  );

export type FindingCluster = z.infer<ReturnType<typeof findingClusterSchema>>;

export const evidenceItemSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      kind: EvidenceKindSchema,
      sourceKind: ShipSecSourceKindSchema.optional(),
      scannerRunId: z.string().optional(),
      artifactUri: nonEmptyString,
      summary: z.string().optional(),
      hash: z.string().optional(),
      capturedAt: isoTimestamp,
      retentionClass: z.enum(['standard', 'audit', 'ephemeral']).default('standard'),
      metadata: jsonRecord.default({}),
    }),
    { schemaName: shipsecEvidenceItemContractName },
  );

export type EvidenceItem = z.infer<ReturnType<typeof evidenceItemSchema>>;

export const complianceControlSchema = () =>
  withPortMeta(
    z.object({
      frameworkId: ComplianceFrameworkSchema,
      controlId: nonEmptyString,
      title: nonEmptyString,
      family: z.string().optional(),
      requirement: nonEmptyString,
      evidenceKinds: z.array(EvidenceKindSchema).default([]),
      mappings: z.array(nonEmptyString).default([]),
      metadata: jsonRecord.default({}),
    }),
    { schemaName: shipsecComplianceControlContractName },
  );

export type ComplianceControl = z.infer<ReturnType<typeof complianceControlSchema>>;

export const controlResultSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      frameworkId: ComplianceFrameworkSchema,
      controlId: nonEmptyString,
      scopeRef: nonEmptyString,
      status: ControlStatusSchema,
      reason: z.string().optional(),
      findingRefs: z.array(nonEmptyString).default([]),
      evidenceRefs: z.array(nonEmptyString).default([]),
      waiverRef: z.string().optional(),
      evaluatedAt: isoTimestamp,
    }),
    { schemaName: shipsecControlResultContractName },
  );

export type ControlResult = z.infer<ReturnType<typeof controlResultSchema>>;

export const graphNodeSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      kind: GraphNodeKindSchema,
      ref: nonEmptyString,
      label: nonEmptyString,
      properties: jsonRecord.default({}),
    }),
    { schemaName: shipsecGraphNodeContractName },
  );

export type GraphNode = z.infer<ReturnType<typeof graphNodeSchema>>;

export const graphEdgeSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      kind: GraphEdgeKindSchema,
      fromNodeRef: nonEmptyString,
      toNodeRef: nonEmptyString,
      confidence: z.number().min(0).max(1).default(1),
      evidenceRefs: z.array(nonEmptyString).default([]),
      properties: jsonRecord.default({}),
    }),
    { schemaName: shipsecGraphEdgeContractName },
  );

export type GraphEdge = z.infer<ReturnType<typeof graphEdgeSchema>>;

export const agentMemoryContextSchema = () =>
  withPortMeta(
    z.object({
      queryId: nonEmptyString,
      organizationId: nonEmptyString,
      kinds: z.array(AgentMemoryKindSchema).default([]),
      hitIds: z.array(nonEmptyString).default([]),
      summary: z.string().optional(),
      usedForProductUpdate: z.boolean().default(false),
      deterministicEvidenceRefs: z.array(nonEmptyString).default([]),
    }),
    { schemaName: shipsecAgentMemoryContextContractName },
  );

export type AgentMemoryContext = z.infer<ReturnType<typeof agentMemoryContextSchema>>;

export const executionUpdateSchema = () =>
  withPortMeta(
    z.object({
      id: nonEmptyString,
      organizationId: nonEmptyString,
      workflowRunId: z.string().optional(),
      agentRunId: z.string().optional(),
      productUpdateKind: ProductUpdateKindSchema,
      targetRef: nonEmptyString,
      evidenceRefs: z.array(nonEmptyString).default([]),
      summary: nonEmptyString,
      createdAt: isoTimestamp,
    }),
    { schemaName: shipsecExecutionUpdateContractName },
  );

export type ExecutionUpdate = z.infer<ReturnType<typeof executionUpdateSchema>>;
