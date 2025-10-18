import {
  ExecutionStatusSchema as SharedExecutionStatusSchema,
  TraceEventSchema as SharedTraceEventSchema,
  TraceStreamEnvelopeSchema as SharedTraceStreamEnvelopeSchema,
  TraceEventLevelSchema,
  TraceEventTypeSchema,
  WorkflowRunStatusSchema as SharedWorkflowRunStatusSchema,
  type ExecutionStatus as SharedExecutionStatus,
  type TraceEventPayload,
  type TraceStreamEnvelope,
  type WorkflowRunStatusPayload,
} from '@shipsec/shared'
import { z } from 'zod'

export const ExecutionStatusEnum = SharedExecutionStatusSchema
export type ExecutionStatus = SharedExecutionStatus

export const TraceEventSchema = SharedTraceEventSchema
export type ExecutionLog = TraceEventPayload

export const TraceEventLevelEnum = TraceEventLevelSchema
export const TraceEventTypeEnum = TraceEventTypeSchema

export const TraceStreamEnvelopeSchema = SharedTraceStreamEnvelopeSchema
export type ExecutionTraceStream = TraceStreamEnvelope

export const ExecutionStatusResponseSchema = SharedWorkflowRunStatusSchema
export type ExecutionStatusResponse = WorkflowRunStatusPayload
