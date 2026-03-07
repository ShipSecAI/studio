import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TriggerSyncSchema = z.object({
  integrationId: z.string().uuid(),
});
export class TriggerSyncDto extends createZodDto(TriggerSyncSchema) {}

const AssetSyncErrorSchema = z.object({
  message: z.string(),
  timestamp: z.string().datetime(),
});

const AssetSyncRunSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  integrationId: z.string().uuid(),
  accountIdentifier: z.string().nullable(),
  temporalWorkflowId: z.string().nullable(),
  temporalRunId: z.string().nullable(),
  status: z.string(),
  coveredRegions: z.array(z.string()).nullable(),
  assetsDiscovered: z.number().int().nullable(),
  assetsCreated: z.number().int().nullable(),
  assetsUpdated: z.number().int().nullable(),
  assetsStale: z.number().int().nullable(),
  errors: z.array(AssetSyncErrorSchema).nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const ReconciledAssetSchema = z.object({
  id: z.string().uuid(),
  assetType: z.string(),
  externalId: z.string(),
  name: z.string().nullable(),
  provider: z.string(),
  region: z.string().nullable(),
  accountIdentifier: z.string().nullable(),
});

const UpdatedAssetSchema = ReconciledAssetSchema.extend({
  changedFields: z.array(z.string()),
});

const AssetScopeSchema = z.object({
  assetType: z.string(),
  region: z.string(),
});

export const CreateSyncRunRequestSchema = z.object({
  integrationId: z.string().uuid(),
  accountIdentifier: z.string(),
  regions: z.array(z.string()),
  temporalWorkflowId: z.string().optional(),
  temporalRunId: z.string().optional(),
});
export class CreateSyncRunRequestDto extends createZodDto(CreateSyncRunRequestSchema) {}

export class CreateSyncRunResponseDto extends createZodDto(AssetSyncRunSchema) {}

export const ReconcileAssetsRequestSchema = z.object({
  integrationId: z.string().uuid(),
  accountIdentifier: z.string(),
  syncRunId: z.string().uuid(),
  assets: z.array(
    z.object({
      assetType: z.string(),
      externalId: z.string(),
      name: z.string(),
      region: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()),
    }),
  ),
});
export class ReconcileAssetsRequestDto extends createZodDto(ReconcileAssetsRequestSchema) {}

export const ReconcileAssetsResponseSchema = z.object({
  created: z.array(ReconciledAssetSchema),
  updated: z.array(UpdatedAssetSchema),
  unchangedCount: z.number().int().nonnegative(),
});
export class ReconcileAssetsResponseDto extends createZodDto(ReconcileAssetsResponseSchema) {}

export const PersistSyncRunScopesRequestSchema = z.object({
  scopes: z.array(AssetScopeSchema),
});
export class PersistSyncRunScopesRequestDto extends createZodDto(
  PersistSyncRunScopesRequestSchema,
) {}

export const PersistSyncRunScopesResponseSchema = z.object({
  success: z.literal(true),
});
export class PersistSyncRunScopesResponseDto extends createZodDto(
  PersistSyncRunScopesResponseSchema,
) {}

export const MarkStaleAssetsRequestSchema = z.object({
  integrationId: z.string().uuid(),
  accountIdentifier: z.string(),
  syncRunId: z.string().uuid(),
  syncStartTime: z.string().datetime(),
});
export class MarkStaleAssetsRequestDto extends createZodDto(MarkStaleAssetsRequestSchema) {}

export const MarkStaleAssetsResponseSchema = z.object({
  newlyStale: z.array(ReconciledAssetSchema),
  newlyRemoved: z.array(ReconciledAssetSchema),
});
export class MarkStaleAssetsResponseDto extends createZodDto(MarkStaleAssetsResponseSchema) {}

export const UpdateSyncRunStatusRequestSchema = z.object({
  status: z.string(),
  assetsDiscovered: z.number().int().optional(),
  assetsCreated: z.number().int().optional(),
  assetsUpdated: z.number().int().optional(),
  assetsStale: z.number().int().optional(),
  coveredRegions: z.array(z.string()).optional(),
  errors: z.array(AssetSyncErrorSchema).optional(),
});
export class UpdateSyncRunStatusRequestDto extends createZodDto(UpdateSyncRunStatusRequestSchema) {}

export class UpdateSyncRunStatusResponseDto extends createZodDto(AssetSyncRunSchema) {}
