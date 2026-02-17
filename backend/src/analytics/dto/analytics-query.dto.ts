import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsQueryRequestDto {
  @ApiProperty({
    description: 'OpenSearch DSL query object',
    example: { match_all: {} },
    required: false,
  })
  query?: Record<string, any>;

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
  })
  aggs?: Record<string, any>;
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
    items: { type: 'object' },
  })
  hits!: {
    _id: string;
    _source: Record<string, any>;
    _score?: number;
  }[];

  @ApiProperty({
    description: 'Aggregation results',
    required: false,
  })
  aggregations?: Record<string, any>;
}
