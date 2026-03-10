import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LiteLLMKeyResponseSchema = z.object({
  virtualKey: z.string().nullable(),
});

export class LiteLLMKeyResponseDto extends createZodDto(LiteLLMKeyResponseSchema) {}
