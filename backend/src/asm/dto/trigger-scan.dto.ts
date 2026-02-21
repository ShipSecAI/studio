import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TriggerScanSchema = z.object({
  templateSlug: z.string().default('sys-attack-surface-recon'),
});

export class TriggerScanDto extends createZodDto(TriggerScanSchema) {}
