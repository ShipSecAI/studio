import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CloudAssetSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  integrationId: z.string().uuid().nullable(),
  provider: z.string(),
  accountIdentifier: z.string().nullable(),
  assetType: z.string(),
  externalId: z.string(),
  name: z.string().nullable(),
  region: z.string().nullable(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  firstDiscoveredAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class CloudAssetDto extends createZodDto(CloudAssetSchema) {}

export const CloudAssetListResponseSchema = z.object({
  assets: z.array(CloudAssetSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export class CloudAssetListResponseDto extends createZodDto(CloudAssetListResponseSchema) {}

const TypeCountSchema = z.object({ assetType: z.string(), count: z.number() });
const RegionCountSchema = z.object({ region: z.string(), count: z.number() });
const StatusCountSchema = z.object({ status: z.string(), count: z.number() });

export const CloudAssetSummarySchema = z.object({
  totalAssets: z.number(),
  byType: z.array(TypeCountSchema),
  byRegion: z.array(RegionCountSchema),
  byStatus: z.array(StatusCountSchema),
});
export class CloudAssetSummaryDto extends createZodDto(CloudAssetSummarySchema) {}

export const CloudSyncTriggerResponseSchema = z.object({
  workflowId: z.string(),
});
export class CloudSyncTriggerResponseDto extends createZodDto(CloudSyncTriggerResponseSchema) {}

const SyncRunErrorSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
});

export const CloudSyncRunSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  integrationId: z.string().uuid(),
  accountIdentifier: z.string().nullable(),
  temporalWorkflowId: z.string().nullable(),
  temporalRunId: z.string().nullable(),
  status: z.string(),
  coveredRegions: z.array(z.string()).nullable(),
  assetsDiscovered: z.number().nullable(),
  assetsCreated: z.number().nullable(),
  assetsUpdated: z.number().nullable(),
  assetsStale: z.number().nullable(),
  errors: z.array(SyncRunErrorSchema).nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export class CloudSyncRunDto extends createZodDto(CloudSyncRunSchema) {}

export const CloudSyncRunListResponseSchema = z.object({
  syncRuns: z.array(CloudSyncRunSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export class CloudSyncRunListResponseDto extends createZodDto(CloudSyncRunListResponseSchema) {}
