
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FileIdParamSchema = z.object({
  id: z.string().uuid(),
});

export class FileIdParamDto extends createZodDto(FileIdParamSchema) {}
