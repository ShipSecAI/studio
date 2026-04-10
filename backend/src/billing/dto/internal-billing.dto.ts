import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BifrostKeyResponseSchema = z.object({
  virtualKey: z.string().nullable(),
});

export class BifrostKeyResponseDto extends createZodDto(BifrostKeyResponseSchema) {}
