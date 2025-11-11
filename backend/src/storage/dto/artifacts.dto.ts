import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListArtifactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  workflowId: z.string().uuid().optional(),
  componentId: z.string().min(1).optional(),
  destination: z.enum(['run', 'library']).optional(),
  search: z.string().min(1).max(200).optional(),
});

export class ListArtifactsQueryDto extends createZodDto(ListArtifactsQuerySchema) {}
export type ListArtifactsQuery = z.infer<typeof ListArtifactsQuerySchema>;

export const ArtifactIdParamSchema = z.object({
  id: z.string().uuid(),
});

export class ArtifactIdParamDto extends createZodDto(ArtifactIdParamSchema) {}
