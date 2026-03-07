import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AgentChatRequestSchema = z.object({
  cursor: z.number().int().nonnegative().optional(),
});

export class AgentChatRequestDto extends createZodDto(AgentChatRequestSchema) {}
