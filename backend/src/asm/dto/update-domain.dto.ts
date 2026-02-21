import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateDomainSchema = z.object({
  scopeInclude: z.array(z.string().max(500)).max(100).optional(),
  scopeExclude: z.array(z.string().max(500)).max(100).optional(),
});

export class UpdateDomainDto extends createZodDto(UpdateDomainSchema) {}
