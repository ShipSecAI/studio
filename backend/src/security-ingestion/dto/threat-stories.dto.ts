import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RecordThreatStoryRequestSchema = z.object({
  storyKey: z.string().min(1).optional(),
  title: z.string().min(1),
  status: z.string().min(1).optional(),
  severity: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().min(1),
  impact: z.string().min(1),
  attackPath: z.string().optional(),
  recommendedAction: z.string().optional(),
  findingIds: z.array(z.string().min(1)).min(1),
  findingRoles: z.record(z.string(), z.string()).optional(),
  findingRationales: z.record(z.string(), z.string()).optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  affectedAssetRefs: z.array(z.string().min(1)).optional(),
  createdByAgentRunId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class RecordThreatStoryRequestDto extends createZodDto(RecordThreatStoryRequestSchema) {}
