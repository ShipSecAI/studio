import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListScansQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('25').transform(Number),
  offset: z.string().regex(/^\d+$/).default('0').transform(Number),
  status: z.enum(['running', 'completed', 'failed', 'timed_out']).optional(),
  domainId: z.string().uuid().optional(),
});

export class ListScansQueryDto extends createZodDto(ListScansQuerySchema) {}
