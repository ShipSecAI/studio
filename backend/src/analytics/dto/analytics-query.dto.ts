import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ProwlerCheckMetadataSchema = z.object({
  checkTitle: z.string().nullable(),
  recommendation: z.string().nullable(),
  recommendationUrl: z.string().nullable(),
  cli: z.string().nullable(),
  nativeIaC: z.string().nullable(),
  terraform: z.string().nullable(),
  other: z.string().nullable(),
});

export class ProwlerCheckMetadataDto extends createZodDto(ProwlerCheckMetadataSchema) {}

export const ProwlerChecksMetadataResponseSchema = z.record(z.string(), ProwlerCheckMetadataSchema);

export class ProwlerChecksMetadataResponseDto extends createZodDto(
  ProwlerChecksMetadataResponseSchema,
) {}
export type ProwlerChecksMetadataResponse = z.infer<typeof ProwlerChecksMetadataResponseSchema>;

export const AnalyticsQueryRequestSchema = z.object({
  query: z.record(z.string(), z.unknown()).optional().describe('OpenSearch DSL query object'),
  size: z.number().optional().describe('Number of results to return'),
  from: z.number().optional().describe('Offset for pagination'),
  aggs: z.record(z.string(), z.unknown()).optional().describe('OpenSearch aggregations object'),
  sort: z.array(z.record(z.string(), z.unknown())).optional().describe('Sort specification'),
  collapse: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Field collapsing specification for deduplication'),
  useLatest: z
    .boolean()
    .optional()
    .describe('Query the deduplicated latest-state index instead of the event log'),
});

export class AnalyticsQueryRequestDto extends createZodDto(AnalyticsQueryRequestSchema) {}

export const AnalyticsQueryResponseSchema = z.object({
  total: z.number().describe('Total number of matching documents'),
  hits: z.array(
    z.object({
      _id: z.string(),
      _source: z.record(z.string(), z.unknown()),
      _score: z.number().optional(),
    }),
  ),
  aggregations: z.record(z.string(), z.unknown()).optional().describe('Aggregation results'),
});

export class AnalyticsQueryResponseDto extends createZodDto(AnalyticsQueryResponseSchema) {}

export const StorageUsageResponseSchema = z.object({
  usedBytes: z.number(),
  documentCount: z.number(),
  indexCount: z.number(),
  opensearchEnabled: z.boolean(),
});
export class StorageUsageResponseDto extends createZodDto(StorageUsageResponseSchema) {}

export const PurgeDataResponseSchema = z.object({
  deletedIndices: z.number(),
});
export class PurgeDataResponseDto extends createZodDto(PurgeDataResponseSchema) {}
