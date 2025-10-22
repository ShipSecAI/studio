import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListFilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export class ListFilesQueryDto extends createZodDto(ListFilesQuerySchema) {}
export type ListFilesQuery = z.infer<typeof ListFilesQuerySchema>;
