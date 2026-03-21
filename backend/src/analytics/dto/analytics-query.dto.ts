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

export const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'in', 'gte', 'lte', 'like', 'prefix', 'not_eq', 'exists', 'not_exists']),
  value: z.unknown().optional(),
});

export const AggSchema = z.object({
  name: z.string(),
  field: z.string(),
  size: z.number().optional(),
});

export const SortSchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']),
});

export const AnalyticsQueryRequestSchema = z.object({
  filters: z.array(FilterSchema).optional().describe('Filter conditions'),
  search: z.string().optional().describe('Free-text search across key fields'),
  aggs: z.array(AggSchema).optional().describe('Named aggregations'),
  sort: z.array(SortSchema).optional().describe('Sort specification'),
  distinct: z.string().optional().describe('Field to deduplicate results on'),
  countDistinct: z
    .string()
    .optional()
    .describe('Field to count distinct values for (returns distinctCount in response)'),
  size: z.number().optional().describe('Number of results to return'),
  from: z.number().optional().describe('Offset for pagination'),
  useLatest: z
    .boolean()
    .optional()
    .describe('Query the deduplicated latest-state index instead of the event log'),
});

export class AnalyticsQueryRequestDto extends createZodDto(AnalyticsQueryRequestSchema) {}

export const AnalyticsQueryResponseSchema = z.object({
  total: z.number().describe('Total number of matching documents'),
  results: z.array(z.record(z.string(), z.unknown())),
  aggregations: z
    .record(z.string(), z.array(z.object({ key: z.string(), count: z.number() })))
    .optional()
    .describe('Aggregation results'),
  distinctCount: z.number().optional().describe('Count of distinct values for countDistinct field'),
});

export class AnalyticsQueryResponseDto extends createZodDto(AnalyticsQueryResponseSchema) {}

export const ScannerSeverityCountsRequestSchema = z.object({
  filters: z.array(FilterSchema).optional(),
  useLatest: z.boolean().optional(),
});

export class ScannerSeverityCountsRequestDto extends createZodDto(
  ScannerSeverityCountsRequestSchema,
) {}

export const ScannerSeverityCountsResponseSchema = z.object({
  buckets: z.array(
    z.object({
      scanner: z.string(),
      severity: z.string(),
      count: z.number(),
    }),
  ),
});

export class ScannerSeverityCountsResponseDto extends createZodDto(
  ScannerSeverityCountsResponseSchema,
) {}

export const TimeSeriesRequestSchema = z.object({
  filters: z.array(FilterSchema).optional(),
  interval: z.enum(['day', 'week', 'month']).optional().default('day'),
  days: z.number().optional().default(30),
  timezone: z.string().optional(),
});

export class TimeSeriesRequestDto extends createZodDto(TimeSeriesRequestSchema) {}

export const TimeSeriesResponseSchema = z.object({
  buckets: z.array(
    z.object({
      date: z.string(),
      severity: z.string(),
      count: z.number(),
    }),
  ),
});

export class TimeSeriesResponseDto extends createZodDto(TimeSeriesResponseSchema) {}

export const LifecycleRequestSchema = z.object({
  hash: z.string().optional(),
  hashes: z.array(z.string()).optional(),
});

export class LifecycleRequestDto extends createZodDto(LifecycleRequestSchema) {}

export const LifecycleResponseSchema = z.object({
  lifecycles: z.record(
    z.string(),
    z.object({
      firstSeen: z.string(),
      lastSeen: z.string(),
      occurrences: z.number(),
    }),
  ),
});

export class LifecycleResponseDto extends createZodDto(LifecycleResponseSchema) {}

export const StorageUsageResponseSchema = z.object({
  usedBytes: z.number(),
  documentCount: z.number(),
  partCount: z.number(),
  analyticsEnabled: z.boolean(),
});
export class StorageUsageResponseDto extends createZodDto(StorageUsageResponseSchema) {}

export const PurgeDataResponseSchema = z.object({
  tablesCleared: z.number(),
});
export class PurgeDataResponseDto extends createZodDto(PurgeDataResponseSchema) {}
