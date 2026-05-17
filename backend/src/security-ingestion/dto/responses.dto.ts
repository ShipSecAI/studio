import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  FindingAssessmentImportanceSchema,
  FindingAssessmentVerdictSchema,
} from './finding-assessments.dto';
import { FindingLinkRelationshipSchema } from './finding-links.dto';

const JsonRecordSchema = z.record(z.string(), z.unknown());

const SecurityFindingSummarySchema = z.object({
  id: z.string(),
  findingKey: z.string(),
  status: z.string(),
  severity: z.string(),
  title: z.string().nullable().optional(),
  sourceKind: z.string(),
});

const SecurityFindingAssessmentSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  verdict: FindingAssessmentVerdictSchema.or(z.string()),
  importance: FindingAssessmentImportanceSchema.or(z.string()),
  confidence: z.number(),
  reasoningMarkdown: z.string(),
  evidenceRefs: z.array(z.string()),
  wikiRefs: z.array(z.string()),
  toolCallsSummary: JsonRecordSchema,
  createdByAgentRunId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  metadata: JsonRecordSchema,
  createdAt: z.string(),
});

const SecurityFindingLinkSchema = z.object({
  id: z.string(),
  fromFindingId: z.string(),
  toFindingId: z.string(),
  relationshipType: FindingLinkRelationshipSchema.or(z.string()),
  confidence: z.number(),
  rationale: z.string(),
  evidenceRefs: z.array(z.string()),
  createdByAgentRunId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  fromFinding: SecurityFindingSummarySchema,
  toFinding: SecurityFindingSummarySchema,
  relatedFinding: SecurityFindingSummarySchema,
  direction: z.enum(['outgoing', 'incoming']),
});

const SecurityFindingEvidenceSchema = z.object({
  id: z.string(),
  summary: z.string().nullable().optional(),
  artifactUri: z.string(),
  capturedAt: z.string(),
});

const SecurityFindingObservationSchema = z.object({
  id: z.string(),
  status: z.string().nullable().optional(),
  title: z.string(),
  observedAt: z.string(),
  runId: z.string().nullable().optional(),
  reviewMode: z.string().nullable().optional(),
  lifecycleHint: z.string().nullable().optional(),
  prNumber: z.string().nullable().optional(),
});

const SecurityFindingSchema = z.object({
  id: z.string(),
  findingKey: z.string(),
  status: z.string(),
  severity: z.string(),
  confidence: z.number(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  sourceKind: z.string(),
  sourceVersion: z.string().nullable().optional(),
  workflowId: z.string().nullable().optional(),
  workflowName: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  repository: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  commitSha: z.string().nullable().optional(),
  prNumber: z.string().nullable().optional(),
  reviewMode: z.string().nullable().optional(),
  lifecycleHint: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  impact: z.string().nullable().optional(),
  fix: z.string().nullable().optional(),
  verification: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
  line: z.number().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  asset: z
    .object({
      id: z.string(),
      kind: z.string(),
      stableKey: z.string(),
      displayName: z.string(),
    })
    .nullable(),
  threatRefs: z.array(z.string()),
  linkedFindingKeys: z.array(z.string()),
  latestAssessment: SecurityFindingAssessmentSchema.nullable().optional(),
  relatedLinks: z.array(SecurityFindingLinkSchema),
  evidence: z.array(SecurityFindingEvidenceSchema),
  observations: z.array(SecurityFindingObservationSchema),
});

const SecurityThreatStoryFindingSchema = SecurityFindingSummarySchema.extend({
  role: z.string(),
  rationale: z.string().nullable().optional(),
});

const SecurityThreatStorySchema = z.object({
  id: z.string(),
  storyKey: z.string(),
  title: z.string(),
  status: z.string(),
  severity: z.string(),
  confidence: z.number(),
  summary: z.string(),
  impact: z.string(),
  attackPath: z.string().nullable().optional(),
  recommendedAction: z.string().nullable().optional(),
  affectedAssetRefs: z.array(z.string()),
  evidenceRefs: z.array(z.string()),
  createdByAgentRunId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  findings: z.array(SecurityThreatStoryFindingSchema),
  metadata: JsonRecordSchema,
});

export class SecurityFindingDto extends createZodDto(SecurityFindingSchema) {}

export const SecurityFindingsResponseSchema = z.object({
  findings: z.array(SecurityFindingSchema),
});

export class SecurityFindingsResponseDto extends createZodDto(SecurityFindingsResponseSchema) {}

export const SecurityFindingResponseSchema = z.object({
  finding: SecurityFindingSchema,
});

export class SecurityFindingResponseDto extends createZodDto(SecurityFindingResponseSchema) {}

export const SecurityFindingEvidenceResponseSchema = z.object({
  evidence: z.array(SecurityFindingEvidenceSchema),
});

export class SecurityFindingEvidenceResponseDto extends createZodDto(
  SecurityFindingEvidenceResponseSchema,
) {}

export const SecurityFindingAssessmentsResponseSchema = z.object({
  assessments: z.array(SecurityFindingAssessmentSchema),
});

export class SecurityFindingAssessmentsResponseDto extends createZodDto(
  SecurityFindingAssessmentsResponseSchema,
) {}

export const RecordFindingAssessmentResponseSchema = z.object({
  assessment: SecurityFindingAssessmentSchema,
});

export class RecordFindingAssessmentResponseDto extends createZodDto(
  RecordFindingAssessmentResponseSchema,
) {}

export const SecurityFindingLinksResponseSchema = z.object({
  links: z.array(SecurityFindingLinkSchema),
});

export class SecurityFindingLinksResponseDto extends createZodDto(
  SecurityFindingLinksResponseSchema,
) {}

export const RecordFindingLinkResponseSchema = z.object({
  link: SecurityFindingLinkSchema,
});

export class RecordFindingLinkResponseDto extends createZodDto(RecordFindingLinkResponseSchema) {}

export const SecurityThreatStoriesResponseSchema = z.object({
  stories: z.array(SecurityThreatStorySchema),
});

export class SecurityThreatStoriesResponseDto extends createZodDto(
  SecurityThreatStoriesResponseSchema,
) {}

export const SecurityThreatStoryResponseSchema = z.object({
  story: SecurityThreatStorySchema,
});

export class SecurityThreatStoryResponseDto extends createZodDto(
  SecurityThreatStoryResponseSchema,
) {}
