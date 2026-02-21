import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListAssetsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('25').transform(Number),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  domainId: z.string().uuid().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['hostname', 'type', 'riskScore', 'firstSeen', 'lastSeen']).default('lastSeen'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export class ListAssetsQueryDto extends createZodDto(ListAssetsQuerySchema) {}
