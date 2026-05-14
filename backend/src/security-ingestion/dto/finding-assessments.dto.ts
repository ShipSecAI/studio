import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FindingAssessmentVerdictSchema = z.enum([
  'actionable',
  'not_relevant',
  'false_positive',
  'accepted_risk',
  'needs_context',
  'resolved_candidate',
]);

export const FindingAssessmentImportanceSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'noise',
]);

export const RecordFindingAssessmentRequestSchema = z.object({
  verdict: FindingAssessmentVerdictSchema,
  importance: FindingAssessmentImportanceSchema,
  confidence: z.number().min(0).max(1).optional(),
  reasoningMarkdown: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  wikiRefs: z.array(z.string().min(1)).optional(),
  toolCallsSummary: z.record(z.string(), z.unknown()).optional(),
  createdByAgentRunId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class RecordFindingAssessmentRequestDto extends createZodDto(
  RecordFindingAssessmentRequestSchema,
) {}
