import { z } from 'zod';

export const ArtifactDestinationSchema = z.enum(['run', 'library']);
export type ArtifactDestination = z.infer<typeof ArtifactDestinationSchema>;

export const ArtifactMetadataSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string().uuid().nullable(),
  componentId: z.string().optional().nullable(),
  componentRef: z.string(),
  fileId: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  destinations: z.array(ArtifactDestinationSchema).nonempty(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  organizationId: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
});
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const RunArtifactsResponseSchema = z.object({
  runId: z.string(),
  artifacts: z.array(ArtifactMetadataSchema),
});
export type RunArtifactsResponse = z.infer<typeof RunArtifactsResponseSchema>;

export const ArtifactLibraryListResponseSchema = z.object({
  artifacts: z.array(ArtifactMetadataSchema),
});
export type ArtifactLibraryListResponse = z.infer<typeof ArtifactLibraryListResponseSchema>;
