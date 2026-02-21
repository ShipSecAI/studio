import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Cloud resource inventory — discovered assets (AWS ECR repos, images, etc.)
 * Separate from ASM domain-based assets (asm_assets table).
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // Soft reference — connections may be hard-deleted; assets survive for audit/history
    integrationId: uuid('integration_id'),
    provider: varchar('provider', { length: 64 }).notNull(), // 'aws', 'github', 'gcp'
    // Stable identity: AWS account ID, GitHub org, etc. Survives connection re-creation.
    accountIdentifier: varchar('account_identifier', { length: 255 }),
    assetType: varchar('asset_type', { length: 64 }).notNull(), // 'ecr_repository', 'ecr_image'
    externalId: text('external_id').notNull(), // ARN or provider-native ID
    name: text('name'),
    region: varchar('region', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    firstDiscoveredAt: timestamp('first_discovered_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 16 }).default('active'), // active/stale/removed
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Deduplicates by real-world identity (not by connection)
    orgProviderTypeExternalUnique: uniqueIndex('assets_org_provider_type_external_uidx').on(
      table.organizationId,
      table.provider,
      table.assetType,
      table.externalId,
    ),
    orgAssetTypeIdx: index('assets_org_asset_type_idx').on(table.organizationId, table.assetType),
    orgIntegrationIdx: index('assets_org_integration_idx').on(
      table.organizationId,
      table.integrationId,
    ),
    statusLastSeenIdx: index('assets_status_last_seen_idx').on(table.status, table.lastSeenAt),
  }),
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

/**
 * Lightweight scan status cache per asset+scanType.
 */
export const assetScanStatus = pgTable(
  'asset_scan_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    scanType: varchar('scan_type', { length: 64 }).notNull(), // 'trivy_image', 'prowler'
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    lastRunId: varchar('last_run_id', { length: 255 }),
    findingCount: integer('finding_count'),
    criticalCount: integer('critical_count'),
    highCount: integer('high_count'),
    status: varchar('status', { length: 16 }).default('unscanned'),
  },
  (table) => ({
    assetScanTypeUnique: uniqueIndex('asset_scan_status_asset_scan_type_uidx').on(
      table.assetId,
      table.scanType,
    ),
  }),
);

export type AssetScanStatus = typeof assetScanStatus.$inferSelect;
export type NewAssetScanStatus = typeof assetScanStatus.$inferInsert;

/**
 * Tracks each sync run for observability and stale-guard queries.
 */
export const assetSyncRuns = pgTable(
  'asset_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // Soft reference — no FK (connection may be deleted)
    integrationId: uuid('integration_id').notNull(),
    accountIdentifier: varchar('account_identifier', { length: 255 }),
    temporalWorkflowId: text('temporal_workflow_id'),
    temporalRunId: text('temporal_run_id'),
    status: varchar('status', { length: 16 }).notNull(), // running/completed/failed
    coveredRegions: jsonb('covered_regions').$type<string[]>().default([]),
    assetsDiscovered: integer('assets_discovered').default(0),
    assetsCreated: integer('assets_created').default(0),
    assetsUpdated: integer('assets_updated').default(0),
    assetsStale: integer('assets_stale').default(0),
    errors: jsonb('errors').$type<{ message: string; timestamp: string }[]>().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIntegrationCreatedIdx: index('asset_sync_runs_org_integration_created_idx').on(
      table.organizationId,
      table.integrationId,
      table.createdAt,
    ),
    orgAccountCreatedIdx: index('asset_sync_runs_org_account_created_idx').on(
      table.organizationId,
      table.accountIdentifier,
      table.createdAt,
    ),
  }),
);

export type AssetSyncRun = typeof assetSyncRuns.$inferSelect;
export type NewAssetSyncRun = typeof assetSyncRuns.$inferInsert;

/**
 * Normalized scopes per sync run — tracks which (assetType, region) pairs
 * were actually scanned. Used for exact-pair stale scoping.
 */
export const assetSyncRunScopes = pgTable(
  'asset_sync_run_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    syncRunId: uuid('sync_run_id')
      .notNull()
      .references(() => assetSyncRuns.id, { onDelete: 'cascade' }),
    assetType: varchar('asset_type', { length: 64 }).notNull(),
    region: varchar('region', { length: 64 }).notNull(),
  },
  (table) => ({
    syncRunScopeUnique: uniqueIndex('asset_sync_run_scopes_run_type_region_uidx').on(
      table.syncRunId,
      table.assetType,
      table.region,
    ),
    syncRunIdx: index('asset_sync_run_scopes_sync_run_idx').on(table.syncRunId),
  }),
);

export type AssetSyncRunScope = typeof assetSyncRunScopes.$inferSelect;
export type NewAssetSyncRunScope = typeof assetSyncRunScopes.$inferInsert;
