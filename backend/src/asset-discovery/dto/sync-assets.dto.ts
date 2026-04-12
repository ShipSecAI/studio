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

const SyncConnectionBindingSchema = z.object({
  connectionId: z.string().uuid(),
  accountIdentifier: z.string().nullable(),
});

export const PrepareSyncContextRequestSchema = z.object({
  integrationId: z.string().uuid(),
  temporalWorkflowId: z.string().optional(),
  temporalRunId: z.string().optional(),
});
export class PrepareSyncContextRequestDto extends createZodDto(PrepareSyncContextRequestSchema) {}

export const PrepareSyncContextResponseSchema = z.object({
  syncRunId: z.string().uuid(),
  neo4jDatabase: z.string(),
  targets: z.array(
    z.object({
      connectionId: z.string().uuid(),
      displayName: z.string(),
      accountIdentifier: z.string().nullable(),
      region: z.string().nullable(),
    }),
  ),
  coveredRegions: z.array(z.string()),
  connectionBindings: z.array(SyncConnectionBindingSchema),
});
export class PrepareSyncContextResponseDto extends createZodDto(PrepareSyncContextResponseSchema) {}

export const RefreshGraphSnapshotRequestSchema = z.object({
  integrationId: z.string().uuid(),
  syncRunId: z.string().uuid(),
  connectionBindings: z.array(SyncConnectionBindingSchema),
});
export class RefreshGraphSnapshotRequestDto extends createZodDto(
  RefreshGraphSnapshotRequestSchema,
) {}

export const RefreshGraphSnapshotResponseSchema = z.object({
  assetsDiscovered: z.number().int().nonnegative(),
  assetsCreated: z.number().int().nonnegative(),
  assetsUpdated: z.number().int().nonnegative(),
  assetsStale: z.number().int().nonnegative(),
  coveredRegions: z.array(z.string()),
});
export class RefreshGraphSnapshotResponseDto extends createZodDto(
  RefreshGraphSnapshotResponseSchema,
) {}

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
