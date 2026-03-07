import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListAssetsSchema = z.object({
  provider: z.string().optional(),
  assetType: z.string().optional(),
  region: z.string().optional(),
  status: z.enum(['active', 'stale', 'removed']).optional(),
  integrationId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  sortBy: z.enum(['name', 'lastSeenAt', 'firstDiscoveredAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export class ListAssetsDto extends createZodDto(ListAssetsSchema) {}
