import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const AgentTraceChunkSchema = z.record(z.string(), z.unknown());

export const AgentTracePartSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  chunk: AgentTraceChunkSchema,
});

export const AgentPartsResponseSchema = z.object({
  agentRunId: z.string(),
  workflowRunId: z.string(),
  nodeRef: z.string(),
  cursor: z.number().int().nonnegative(),
  parts: z.array(AgentTracePartSchema),
});

export class AgentPartsResponseDto extends createZodDto(AgentPartsResponseSchema) {}
