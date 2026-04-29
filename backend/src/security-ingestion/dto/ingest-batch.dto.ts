import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { shipsecIngestionBatchSchema } from '@shipsec/contracts';

export const PersistSecurityIngestionBatchRequestSchema = z.object({
  batch: shipsecIngestionBatchSchema(),
});

export const PersistSecurityIngestionBatchResponseSchema = z.object({
  batchId: z.string(),
  scannerRunId: z.string(),
  assetCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  controlResultCount: z.number().int().nonnegative(),
  graphEdgeCount: z.number().int().nonnegative(),
});

export class PersistSecurityIngestionBatchRequestDto extends createZodDto(
  PersistSecurityIngestionBatchRequestSchema,
) {}

export class PersistSecurityIngestionBatchResponseDto extends createZodDto(
  PersistSecurityIngestionBatchResponseSchema,
) {}
