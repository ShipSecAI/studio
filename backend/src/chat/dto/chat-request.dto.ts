import { z } from 'zod';

export const ChatRequestSchema = z.object({
  messages: z.array(z.any()).min(1),
});

export type ChatRequestDto = z.infer<typeof ChatRequestSchema>;
