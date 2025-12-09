import { z } from 'zod';

export const AgentStreamQuerySchema = z.object({
  cursor: z.string().optional(),
});

export type AgentStreamQueryDto = z.infer<typeof AgentStreamQuerySchema>;
