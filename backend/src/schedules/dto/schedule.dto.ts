import {
  ScheduleInputPayloadSchema,
  ScheduleOverlapPolicySchema,
  ScheduleStatusSchema,
  WorkflowScheduleSchema,
} from '@shipsec/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateScheduleRequestSchema = z.object({
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  cronExpression: z.string().min(1),
  timezone: z.string().min(1),
  humanLabel: z.string().optional().nullable(),
  overlapPolicy: ScheduleOverlapPolicySchema.default('skip'),
  catchupWindowSeconds: z.coerce.number().int().nonnegative().default(0),
  inputPayload: ScheduleInputPayloadSchema.default({
    runtimeInputs: {},
    nodeOverrides: {},
  }),
});

export const UpdateScheduleRequestSchema = CreateScheduleRequestSchema.partial().extend({
  status: ScheduleStatusSchema.optional(),
});

export const ListSchedulesQuerySchema = z.object({
  workflowId: z.string().uuid().optional(),
  status: ScheduleStatusSchema.optional(),
});

export class CreateScheduleRequestDto extends createZodDto(CreateScheduleRequestSchema) {}
export class UpdateScheduleRequestDto extends createZodDto(UpdateScheduleRequestSchema) {}
export class ListSchedulesQueryDto extends createZodDto(ListSchedulesQuerySchema) {}
export class ScheduleResponseDto extends createZodDto(WorkflowScheduleSchema) {}
