import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
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

export class AnalyticsQueryRequestDto {
  @ApiProperty({
    description: 'OpenSearch DSL query object',
    example: { match_all: {} },
    required: false,
    type: 'object',
    additionalProperties: true,
  })
  query?: Record<string, object | string | number | boolean | null>;

  @ApiProperty({
    description: 'Number of results to return',
    example: 10,
    default: 10,
    minimum: 0,
    maximum: 1000,
    required: false,
  })
  size?: number;

  @ApiProperty({
    description: 'Offset for pagination',
    example: 0,
    default: 0,
    minimum: 0,
    maximum: 10000,
    required: false,
  })
  from?: number;

  @ApiProperty({
    description: 'OpenSearch aggregations object',
    example: {
      components: {
        terms: { field: 'component_id' },
      },
    },
    required: false,
    type: 'object',
    additionalProperties: true,
  })
  aggs?: Record<string, object | string | number | boolean | null>;

  @ApiProperty({
    description: 'Sort specification',
    required: false,
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
    },
  })
  sort?: Record<string, object | string | number | boolean | null>[];

  @ApiProperty({
    description: 'Field collapsing specification for deduplication',
    required: false,
    type: 'object',
    additionalProperties: true,
  })
  collapse?: Record<string, object | string | number | boolean | null>;

  @ApiProperty({
    description: 'Query the deduplicated latest-state index instead of the event log',
    required: false,
    default: false,
  })
  useLatest?: boolean;
}

export class AnalyticsQueryResponseDto {
  @ApiProperty({
    description: 'Total number of matching documents',
    example: 100,
  })
  total!: number;

  @ApiProperty({
    description: 'Search hits',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        _id: { type: 'string' },
        _source: {
          type: 'object',
          additionalProperties: true,
        },
        _score: { type: 'number' },
      },
      required: ['_id', '_source'],
      additionalProperties: false,
    },
  })
  hits!: {
    _id: string;
    _source: Record<string, object | string | number | boolean | null>;
    _score?: number;
  }[];

  @ApiProperty({
    description: 'Aggregation results',
    required: false,
    type: 'object',
    additionalProperties: true,
  })
  aggregations?: Record<string, object | string | number | boolean | null>;
}
