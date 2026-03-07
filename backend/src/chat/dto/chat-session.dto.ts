import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const UiMessagePartSchema = z.record(z.string(), z.unknown());

export const CreateSessionSchema = z.object({
  title: z.string().max(200).optional(),
});
export class CreateSessionDto extends createZodDto(CreateSessionSchema) {}

export const UpdateSessionSchema = z.object({
  title: z.string().min(1).max(200),
});
export class UpdateSessionDto extends createZodDto(UpdateSessionSchema) {}

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
export class SubmitOperationDto extends createZodDto(SubmitOperationSchema) {}

export const AppendInternalEventSchema = z.object({
  turnId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  generationId: z.union([z.string(), z.number()]).optional(),
  eventId: z.string().min(1),
  chunk: z.record(z.string(), z.unknown()),
});
export class AppendInternalEventDto extends createZodDto(AppendInternalEventSchema) {}

export const CompleteRunRequestSchema = z.object({
  runId: z.string().uuid().optional(),
});
export class CompleteRunRequestDto extends createZodDto(CompleteRunRequestSchema) {}

export const ChatSessionResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  processingStatus: z.enum(['idle', 'processing', 'stopping']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class ChatSessionResponseDto extends createZodDto(ChatSessionResponseSchema) {}

export const DeleteSessionResponseSchema = z.object({
  success: z.literal(true),
});
export class DeleteSessionResponseDto extends createZodDto(DeleteSessionResponseSchema) {}

export const SubmitOperationResponseSchema = z.object({
  submissionId: z.string(),
  op: z.enum(['UserTurn', 'Interrupt', 'SteerNow']).optional(),
  operation: z.enum(['UserTurn', 'Interrupt', 'SteerNow']),
  turnId: z.string().uuid().optional().nullable(),
  interruptedTurnId: z.string().uuid().optional().nullable(),
  generationId: z.number().int().nonnegative().optional(),
  acceptedAtSeq: z.number().int().nonnegative(),
});
export class SubmitOperationResponseDto extends createZodDto(SubmitOperationResponseSchema) {}

export const ThreadHistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  parts: z.array(UiMessagePartSchema),
  createdAt: z.string().datetime().optional(),
});

export const InterruptionBoundarySchema = z.object({
  turnId: z.string().uuid(),
  beforeMessageIndex: z.number().int().nonnegative(),
});

export const ThreadQueueItemSchema = z.object({
  turnId: z.string().uuid(),
  queuePosition: z.number().int().positive(),
  status: z.string(),
  preview: z.string().nullable().optional(),
  queuedAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

export const ThreadHistoryResponseSchema = z.object({
  messages: z.array(ThreadHistoryMessageSchema),
  interruptionBoundaries: z.array(InterruptionBoundarySchema),
  activeTurn: z
    .object({
      turnId: z.string().uuid(),
      status: z.string(),
      generationId: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  generationId: z.number().int().nonnegative(),
  activeGeneration: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  queue: z.array(ThreadQueueItemSchema),
  queuedTurns: z.array(ThreadQueueItemSchema),
  queueOrder: z.array(z.string().uuid()),
  processingStatus: z.enum(['idle', 'processing', 'stopping']),
  afterSeq: z.number().int().nonnegative(),
  lastSeq: z.number().int().nonnegative(),
});
export class ThreadHistoryResponseDto extends createZodDto(ThreadHistoryResponseSchema) {}

export const ChatEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  turnId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  generationId: z.string().nullable(),
  eventId: z.string(),
  chunk: z.record(z.string(), z.unknown()),
});

export const ChatEventsResponseSchema = z.object({
  events: z.array(ChatEventSchema),
});
export class ChatEventsResponseDto extends createZodDto(ChatEventsResponseSchema) {}

export const AppendInternalEventResponseSchema = z.object({
  seq: z.number().int().nonnegative(),
});
export class AppendInternalEventResponseDto extends createZodDto(
  AppendInternalEventResponseSchema,
) {}

export const RunCompletionResponseSchema = z.object({
  success: z.literal(true),
});
export class RunCompletionResponseDto extends createZodDto(RunCompletionResponseSchema) {}
