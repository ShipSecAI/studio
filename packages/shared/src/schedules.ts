import { z } from 'zod';

import { ExecutionInputPreviewSchema } from './execution.js';

export const ScheduleStatusSchema = z.enum(['active', 'paused', 'error']);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

export const ScheduleOverlapPolicySchema = z.enum(['skip', 'buffer', 'allow']);
export type ScheduleOverlapPolicy = z.infer<typeof ScheduleOverlapPolicySchema>;

export const ScheduleInputPayloadSchema = ExecutionInputPreviewSchema;
export type ScheduleInputPayload = z.infer<typeof ScheduleInputPayloadSchema>;

export const WorkflowScheduleSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid().nullable(),
  workflowVersion: z.number().int().positive().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  cronExpression: z.string(),
  timezone: z.string(),
  humanLabel: z.string().nullable(),
  overlapPolicy: ScheduleOverlapPolicySchema,
  catchupWindowSeconds: z.number().int().nonnegative().default(0),
  status: ScheduleStatusSchema,
  lastRunAt: z.string().datetime().nullable(),
  nextRunAt: z.string().datetime().nullable(),
  inputPayload: ScheduleInputPayloadSchema,
  temporalScheduleId: z.string().nullable(),
  temporalSnapshot: z.record(z.string(), z.unknown()).default({}),
  organizationId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WorkflowSchedule = z.infer<typeof WorkflowScheduleSchema>;
