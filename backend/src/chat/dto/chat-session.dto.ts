import { z } from 'zod';

export const CreateSessionSchema = z.object({
  title: z.string().max(200).optional(),
});
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;

export const UpdateSessionSchema = z.object({
  title: z.string().min(1).max(200),
});
export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>;

export const SubmitOperationSchema = z
  .object({
    op: z.enum(['UserTurn', 'Interrupt', 'SteerNow']),
    text: z.string().min(1).optional(),
    clientSubmissionId: z.string().min(1),
    clientTurnHint: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.op === 'UserTurn' || value.op === 'SteerNow') && !value.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text is required for UserTurn and SteerNow',
        path: ['text'],
      });
    }
  });
export type SubmitOperationDto = z.infer<typeof SubmitOperationSchema>;

export const AppendInternalEventSchema = z.object({
  turnId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  generationId: z.union([z.string(), z.number()]).optional(),
  eventId: z.string().min(1),
  chunk: z.record(z.string(), z.any()),
});
export type AppendInternalEventDto = z.infer<typeof AppendInternalEventSchema>;
