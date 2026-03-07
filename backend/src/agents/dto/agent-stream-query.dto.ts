import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AgentStreamQuerySchema = z.object({
  cursor: z.string().optional(),
});

export class AgentStreamQueryDto extends createZodDto(AgentStreamQuerySchema) {}
