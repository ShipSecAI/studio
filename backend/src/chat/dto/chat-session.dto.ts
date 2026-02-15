import { z } from 'zod';

export const CreateSessionSchema = z.object({
  title: z.string().max(200).optional(),
});
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;

export const UpdateSessionSchema = z.object({
  title: z.string().min(1).max(200),
});
export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>;

export const SendMessageSchema = z.object({
  messages: z.array(z.any()).min(1),
});
export type SendMessageDto = z.infer<typeof SendMessageSchema>;
