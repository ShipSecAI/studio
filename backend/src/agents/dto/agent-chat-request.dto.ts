import { z } from 'zod';

export const AgentChatRequestSchema = z.object({
  cursor: z.number().int().nonnegative().optional(),
});

export type AgentChatRequestDto = z.infer<typeof AgentChatRequestSchema>;
