import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Input type enum
export const HumanInputTypeSchema = z.enum(['approval', 'form', 'selection', 'review', 'acknowledge']);
export type HumanInputType = z.infer<typeof HumanInputTypeSchema>;

// Status enum
export const HumanInputStatusSchema = z.enum(['pending', 'resolved', 'expired', 'cancelled']);
export type HumanInputStatus = z.infer<typeof HumanInputStatusSchema>;

// ===== Request DTOs =====

export const ResolveHumanInputSchema = z.object({
  responseData: z.record(z.string(), z.unknown()).optional().describe('The response data from the human'),
  respondedBy: z.string().optional().describe('User ID or identifier of who resolved the input'),
});

export class ResolveHumanInputDto extends createZodDto(ResolveHumanInputSchema) {}

export const ListHumanInputsQuerySchema = z.object({
  status: HumanInputStatusSchema.optional(),
  inputType: HumanInputTypeSchema.optional(),
});

export class ListHumanInputsQueryDto extends createZodDto(ListHumanInputsQuerySchema) {}

export const ResolveByTokenSchema = z.object({
  action: z.enum(['approve', 'reject', 'resolve']).optional().default('resolve'),
  data: z.record(z.string(), z.unknown()).optional(),
});

export class ResolveByTokenDto extends createZodDto(ResolveByTokenSchema) {}

// ===== Response DTOs =====

export const HumanInputResponseSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  workflowId: z.string().uuid(),
  nodeRef: z.string(),
  status: HumanInputStatusSchema,
  inputType: HumanInputTypeSchema,
  inputSchema: z.any().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  context: z.any().nullable(),
  resolveToken: z.string(),
  timeoutAt: z.string().nullable(),
  responseData: z.any().nullable(),
  respondedAt: z.string().nullable(),
  respondedBy: z.string().nullable(),
  organizationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class HumanInputResponseDto extends createZodDto(HumanInputResponseSchema) {}

export const PublicResolveResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  input: z.object({
    id: z.string().uuid(),
    title: z.string(),
    inputType: HumanInputTypeSchema,
    status: HumanInputStatusSchema,
    respondedAt: z.string().nullable(),
  }),
});

export class PublicResolveResultDto extends createZodDto(PublicResolveResultSchema) {}
