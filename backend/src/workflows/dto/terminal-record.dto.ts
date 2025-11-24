import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const TerminalArchiveRequestSchema = z.object({
  nodeRef: z.string().trim().min(1),
  stream: z.enum(['stdout', 'stderr', 'pty']).default('pty').optional(),
  width: z.number().int().positive().max(400).optional(),
  height: z.number().int().positive().max(200).optional(),
});

export class TerminalArchiveRequestDto extends createZodDto(TerminalArchiveRequestSchema) {}

export const TerminalRecordingSchema = z.object({
  id: z.number().int().positive(),
  runId: z.string(),
  nodeRef: z.string(),
  stream: z.string(),
  fileId: z.string().uuid(),
  chunkCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export class TerminalRecordingDto extends createZodDto(TerminalRecordingSchema) {}
export class TerminalRecordListDto extends createZodDto(
  z.object({
    runId: z.string(),
    records: z.array(TerminalRecordingSchema),
  }),
) {}

export const TerminalRecordParamSchema = z.object({
  recordId: z.coerce.number().int().positive(),
});

export class TerminalRecordParamDto extends createZodDto(TerminalRecordParamSchema) {}
