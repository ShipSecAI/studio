import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FindingLinkRelationshipSchema = z.enum([
  'duplicate_of',
  'same_root_cause',
  'enables',
  'contradicts',
  'same_asset',
  'same_control',
  'mitigated_by',
  'related',
]);

export const RecordFindingLinkRequestSchema = z.object({
  toFindingId: z.string().min(1),
  relationshipType: FindingLinkRelationshipSchema,
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  createdByAgentRunId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class RecordFindingLinkRequestDto extends createZodDto(RecordFindingLinkRequestSchema) {}
