import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WebhookRunWorkflowSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  versionId: z.string().optional(),
  version: z.number().int().optional(),
});

export class WebhookRunWorkflowDto extends createZodDto(WebhookRunWorkflowSchema) {}
