import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListSyncRunsSchema = z.object({
  integrationId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export class ListSyncRunsDto extends createZodDto(ListSyncRunsSchema) {}
