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

export const EnqueueTurnSchema = z.object({
  message: z.string().min(1),
  clientMessageId: z.string().min(1).optional(),
});
export type EnqueueTurnDto = z.infer<typeof EnqueueTurnSchema>;

export const SteerSessionSchema = z.object({
  targetTurnId: z.string().uuid().optional(),
});
export type SteerSessionDto = z.infer<typeof SteerSessionSchema>;

export const AppendInternalEventSchema = z.object({
  turnId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  generationId: z.union([z.string(), z.number()]).optional(),
  eventId: z.string().min(1),
  chunk: z.record(z.string(), z.any()),
});
export type AppendInternalEventDto = z.infer<typeof AppendInternalEventSchema>;
