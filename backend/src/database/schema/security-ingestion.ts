import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Durable security product truth.
 *
 * These tables mirror the ShipSec north-star ingestion contracts. Scanner output
 * can still flow to ClickHouse for fast analytics, but Postgres owns the product
 * graph: scanner lineage, stable asset identities, observations, finding
 * instances, evidence, compliance impact, and graph edges.
 */

export const securityScannerRuns = pgTable(
  'security_scanner_runs',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    sourceKind: varchar('source_kind', { length: 64 }).notNull(),
    sourceVersion: varchar('source_version', { length: 128 }),
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull().default({}),
    triggerKind: varchar('trigger_kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    parentRunId: text('parent_run_id'),
    artifactRefs: jsonb('artifact_refs').$type<Record<string, unknown>[]>().notNull().default([]),
    configHash: varchar('config_hash', { length: 128 }),
    workflowId: text('workflow_id'),
    runId: text('run_id'),
    nodeRef: text('node_ref'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgSourceStartedIdx: index('security_scanner_runs_org_source_started_idx').on(
      table.organizationId,
      table.sourceKind,
      table.startedAt,
    ),
    orgRunIdx: index('security_scanner_runs_org_run_idx').on(table.organizationId, table.runId),
    orgStatusIdx: index('security_scanner_runs_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
  }),
);

export const securityIngestionBatches = pgTable(
  'security_ingestion_batches',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    sourceKind: varchar('source_kind', { length: 64 }).notNull(),
    scannerRunId: text('scanner_run_id')
      .notNull()
      .references(() => securityScannerRuns.id, { onDelete: 'cascade' }),
    stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default({}),
    validation: jsonb('validation').$type<Record<string, unknown>>().notNull().default({}),
    rawBatch: jsonb('raw_batch').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index('security_ingestion_batches_org_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    scannerRunIdx: index('security_ingestion_batches_scanner_run_idx').on(table.scannerRunId),
  }),
);

export const securityAssets = pgTable(
  'security_assets',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    assetKind: varchar('asset_kind', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 64 }),
    nativeId: text('native_id'),
    stableKey: text('stable_key').notNull(),
    displayName: text('display_name').notNull(),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    confidence: varchar('confidence', { length: 32 }).notNull(),
    ownerRef: text('owner_ref'),
    environment: varchar('environment', { length: 64 }),
    criticality: varchar('criticality', { length: 32 }).notNull().default('unknown'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgStableKeyUnique: uniqueIndex('security_assets_org_stable_key_uidx').on(
      table.organizationId,
      table.stableKey,
    ),
    orgKindIdx: index('security_assets_org_kind_idx').on(table.organizationId, table.assetKind),
    orgProviderIdx: index('security_assets_org_provider_idx').on(
      table.organizationId,
      table.provider,
    ),
  }),
);

export const securityAssetAliases = pgTable(
  'security_asset_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => securityAssets.id, { onDelete: 'cascade' }),
    aliasType: varchar('alias_type', { length: 64 }).notNull().default('native'),
    aliasValue: text('alias_value').notNull(),
    sourceKind: varchar('source_kind', { length: 64 }),
    confidence: varchar('confidence', { length: 32 }).notNull().default('deterministic'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgAliasUnique: uniqueIndex('security_asset_aliases_org_alias_uidx').on(
      table.organizationId,
      table.aliasType,
      table.aliasValue,
    ),
    assetIdx: index('security_asset_aliases_asset_idx').on(table.assetId),
  }),
);

export const securityEvidenceItems = pgTable(
  'security_evidence_items',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 64 }).notNull(),
    sourceKind: varchar('source_kind', { length: 64 }),
    scannerRunId: text('scanner_run_id').references(() => securityScannerRuns.id, {
      onDelete: 'set null',
    }),
    artifactUri: text('artifact_uri').notNull(),
    summary: text('summary'),
    hash: varchar('hash', { length: 128 }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    retentionClass: varchar('retention_class', { length: 32 }).notNull().default('standard'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgKindCapturedIdx: index('security_evidence_items_org_kind_captured_idx').on(
      table.organizationId,
      table.kind,
      table.capturedAt,
    ),
    scannerRunIdx: index('security_evidence_items_scanner_run_idx').on(table.scannerRunId),
  }),
);

export const securityObservations = pgTable(
  'security_observations',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    scannerRunId: text('scanner_run_id')
      .notNull()
      .references(() => securityScannerRuns.id, { onDelete: 'cascade' }),
    sourceKind: varchar('source_kind', { length: 64 }).notNull(),
    sourceRuleId: text('source_rule_id'),
    assetId: text('asset_id').references(() => securityAssets.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 64 }),
    severity: varchar('severity', { length: 32 }).notNull().default('unknown'),
    title: text('title').notNull(),
    rawArtifactRef: jsonb('raw_artifact_ref').$type<Record<string, unknown>>(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    normalized: jsonb('normalized').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgObservedIdx: index('security_observations_org_observed_idx').on(
      table.organizationId,
      table.observedAt,
    ),
    orgRuleIdx: index('security_observations_org_rule_idx').on(
      table.organizationId,
      table.sourceKind,
      table.sourceRuleId,
    ),
    assetIdx: index('security_observations_asset_idx').on(table.assetId),
    scannerRunIdx: index('security_observations_scanner_run_idx').on(table.scannerRunId),
  }),
);

export const securityFindingInstances = pgTable(
  'security_finding_instances',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    scannerRunId: text('scanner_run_id')
      .notNull()
      .references(() => securityScannerRuns.id, { onDelete: 'cascade' }),
    assetId: text('asset_id').references(() => securityAssets.id, { onDelete: 'set null' }),
    findingKey: text('finding_key').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    severity: varchar('severity', { length: 32 }).notNull(),
    confidence: real('confidence').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    observationRefs: jsonb('observation_refs').$type<string[]>().notNull().default([]),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    suppressionRef: text('suppression_ref'),
    acceptedRiskRef: text('accepted_risk_ref'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFindingKeyUnique: uniqueIndex('security_finding_instances_org_key_uidx').on(
      table.organizationId,
      table.findingKey,
    ),
    orgSeverityStatusIdx: index('security_findings_org_severity_status_idx').on(
      table.organizationId,
      table.severity,
      table.status,
    ),
    assetIdx: index('security_finding_instances_asset_idx').on(table.assetId),
    scannerRunIdx: index('security_finding_instances_scanner_run_idx').on(table.scannerRunId),
  }),
);

export const securityControlMappings = pgTable(
  'security_control_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }),
    sourceKind: varchar('source_kind', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 64 }),
    sourceRuleId: text('source_rule_id').notNull(),
    frameworkKey: varchar('framework_key', { length: 64 }).notNull(),
    controlId: varchar('control_id', { length: 128 }).notNull(),
    controlTitle: text('control_title'),
    mappingSource: varchar('mapping_source', { length: 64 }).notNull().default('scanner'),
    confidence: real('confidence').notNull().default(0.8),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceControlUnique: uniqueIndex('security_control_mappings_source_control_uidx').on(
      table.organizationId,
      table.sourceKind,
      table.provider,
      table.sourceRuleId,
      table.frameworkKey,
      table.controlId,
    ),
    frameworkControlIdx: index('security_control_mappings_framework_control_idx').on(
      table.frameworkKey,
      table.controlId,
    ),
  }),
);

export const securityControlResults = pgTable(
  'security_control_results',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    frameworkKey: varchar('framework_key', { length: 64 }).notNull(),
    controlId: varchar('control_id', { length: 128 }).notNull(),
    scopeRef: text('scope_ref').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    reason: text('reason'),
    observationId: text('observation_id').references(() => securityObservations.id, {
      onDelete: 'set null',
    }),
    findingRefs: jsonb('finding_refs').$type<string[]>().notNull().default([]),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    waiverRef: text('waiver_ref'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFrameworkStatusIdx: index('security_control_results_org_framework_status_idx').on(
      table.organizationId,
      table.frameworkKey,
      table.status,
    ),
    orgControlScopeIdx: index('security_control_results_org_control_scope_idx').on(
      table.organizationId,
      table.frameworkKey,
      table.controlId,
      table.scopeRef,
    ),
    observationIdx: index('security_control_results_observation_idx').on(table.observationId),
  }),
);

export const securityFindingControlLinks = pgTable(
  'security_finding_control_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    findingId: text('finding_id')
      .notNull()
      .references(() => securityFindingInstances.id, { onDelete: 'cascade' }),
    controlResultId: text('control_result_id').references(() => securityControlResults.id, {
      onDelete: 'cascade',
    }),
    frameworkKey: varchar('framework_key', { length: 64 }).notNull(),
    controlId: varchar('control_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('fail'),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    findingControlUnique: uniqueIndex('security_finding_control_links_finding_control_uidx').on(
      table.findingId,
      table.frameworkKey,
      table.controlId,
    ),
    orgControlIdx: index('security_finding_control_links_org_control_idx').on(
      table.organizationId,
      table.frameworkKey,
      table.controlId,
    ),
  }),
);

export const securityFindingLinks = pgTable(
  'security_finding_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    fromFindingId: text('from_finding_id')
      .notNull()
      .references(() => securityFindingInstances.id, { onDelete: 'cascade' }),
    toFindingId: text('to_finding_id')
      .notNull()
      .references(() => securityFindingInstances.id, { onDelete: 'cascade' }),
    relationshipType: varchar('relationship_type', { length: 64 }).notNull(),
    confidence: real('confidence').notNull().default(0.7),
    rationale: text('rationale').notNull(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    createdByAgentRunId: text('created_by_agent_run_id'),
    createdBy: text('created_by'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFromIdx: index('security_finding_links_org_from_idx').on(
      table.organizationId,
      table.fromFindingId,
    ),
    orgToIdx: index('security_finding_links_org_to_idx').on(
      table.organizationId,
      table.toFindingId,
    ),
    orgPairUnique: uniqueIndex('security_finding_links_org_pair_type_uidx').on(
      table.organizationId,
      table.fromFindingId,
      table.toFindingId,
      table.relationshipType,
    ),
  }),
);

export const securityFindingAssessments = pgTable(
  'security_finding_assessments',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    findingId: text('finding_id')
      .notNull()
      .references(() => securityFindingInstances.id, { onDelete: 'cascade' }),
    verdict: varchar('verdict', { length: 64 }).notNull(),
    importance: varchar('importance', { length: 32 }).notNull(),
    confidence: real('confidence').notNull().default(0.7),
    reasoningMarkdown: text('reasoning_markdown').notNull(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    wikiRefs: jsonb('wiki_refs').$type<string[]>().notNull().default([]),
    toolCallsSummary: jsonb('tool_calls_summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByAgentRunId: text('created_by_agent_run_id'),
    createdBy: text('created_by'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgFindingCreatedIdx: index('security_finding_assessments_org_finding_created_idx').on(
      table.organizationId,
      table.findingId,
      table.createdAt,
    ),
    orgVerdictIdx: index('security_finding_assessments_org_verdict_idx').on(
      table.organizationId,
      table.verdict,
      table.importance,
    ),
    agentRunIdx: index('security_finding_assessments_agent_run_idx').on(table.createdByAgentRunId),
  }),
);

export const securityThreatStories = pgTable(
  'security_threat_stories',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    storyKey: text('story_key').notNull(),
    title: text('title').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('open'),
    severity: varchar('severity', { length: 32 }).notNull(),
    confidence: real('confidence').notNull().default(0.7),
    summary: text('summary').notNull(),
    impact: text('impact').notNull(),
    attackPath: text('attack_path'),
    recommendedAction: text('recommended_action'),
    affectedAssetRefs: jsonb('affected_asset_refs').$type<string[]>().notNull().default([]),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    createdByAgentRunId: text('created_by_agent_run_id'),
    createdBy: text('created_by'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgStoryKeyUnique: uniqueIndex('security_threat_stories_org_key_uidx').on(
      table.organizationId,
      table.storyKey,
    ),
    orgSeverityStatusIdx: index('security_threat_stories_org_severity_status_idx').on(
      table.organizationId,
      table.severity,
      table.status,
    ),
    orgUpdatedIdx: index('security_threat_stories_org_updated_idx').on(
      table.organizationId,
      table.updatedAt,
    ),
  }),
);

export const securityThreatStoryFindings = pgTable(
  'security_threat_story_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    storyId: text('story_id')
      .notNull()
      .references(() => securityThreatStories.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => securityFindingInstances.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 64 }).notNull().default('supporting'),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storyFindingUnique: uniqueIndex('security_threat_story_findings_story_finding_uidx').on(
      table.storyId,
      table.findingId,
    ),
    orgFindingIdx: index('security_threat_story_findings_org_finding_idx').on(
      table.organizationId,
      table.findingId,
    ),
  }),
);

export const securityGraphEdges = pgTable(
  'security_graph_edges',
  {
    id: text('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    edgeKind: varchar('edge_kind', { length: 64 }).notNull(),
    fromNodeRef: text('from_node_ref').notNull(),
    toNodeRef: text('to_node_ref').notNull(),
    confidence: real('confidence').notNull().default(1),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgKindIdx: index('security_graph_edges_org_kind_idx').on(table.organizationId, table.edgeKind),
    orgFromIdx: index('security_graph_edges_org_from_idx').on(
      table.organizationId,
      table.fromNodeRef,
    ),
    orgToIdx: index('security_graph_edges_org_to_idx').on(table.organizationId, table.toNodeRef),
  }),
);

export type SecurityScannerRunRecord = typeof securityScannerRuns.$inferSelect;
export type NewSecurityScannerRunRecord = typeof securityScannerRuns.$inferInsert;
export type SecurityIngestionBatchRecord = typeof securityIngestionBatches.$inferSelect;
export type NewSecurityIngestionBatchRecord = typeof securityIngestionBatches.$inferInsert;
export type SecurityAssetRecord = typeof securityAssets.$inferSelect;
export type NewSecurityAssetRecord = typeof securityAssets.$inferInsert;
export type SecurityObservationRecord = typeof securityObservations.$inferSelect;
export type NewSecurityObservationRecord = typeof securityObservations.$inferInsert;
export type SecurityFindingInstanceRecord = typeof securityFindingInstances.$inferSelect;
export type NewSecurityFindingInstanceRecord = typeof securityFindingInstances.$inferInsert;
export type SecurityEvidenceItemRecord = typeof securityEvidenceItems.$inferSelect;
export type NewSecurityEvidenceItemRecord = typeof securityEvidenceItems.$inferInsert;
export type SecurityControlResultRecord = typeof securityControlResults.$inferSelect;
export type NewSecurityControlResultRecord = typeof securityControlResults.$inferInsert;
