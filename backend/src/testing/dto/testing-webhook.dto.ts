import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AcceptWebhookQuerySchema = z.object({
  status: z.coerce.number().int().min(100).max(599).optional(),
  delayMs: z.coerce.number().int().min(0).max(60_000).optional(),
});

export class AcceptWebhookQueryDto extends createZodDto(AcceptWebhookQuerySchema) {}
