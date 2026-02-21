import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListDomainsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('50').transform(Number),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number),
});

export class ListDomainsQueryDto extends createZodDto(ListDomainsQuerySchema) {}
