import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const AsmAssetPortSchema = z.object({
  port: z.number().int().min(1).max(65535),
  protocol: z.string().trim().min(1).max(32).default('tcp'),
  service: z.string().trim().max(128).default(''),
});

export const AsmAssetUpsertItemSchema = z.object({
  hostname: z.string().trim().min(1).max(512),
  type: z.string().trim().min(1).max(50).default('subdomain'),
  ipAddresses: z.array(z.string().trim().min(1)).default([]),
  techStack: z.array(z.string().trim().min(1)).default([]),
  ports: z.array(AsmAssetPortSchema).default([]),
  riskScore: z.union([z.number(), z.string()]).optional(),
  dnsRecords: JsonRecordSchema.optional(),
  tlsInfo: JsonRecordSchema.optional(),
  metadata: JsonRecordSchema.optional(),
});

export const UpsertAsmAssetsRequestSchema = z
  .object({
    domainId: z.string().uuid().optional(),
    domain: z.string().trim().min(1).max(255).optional(),
    runId: z.string().optional(),
    workflowId: z.string().optional(),
    assets: z.array(AsmAssetUpsertItemSchema).max(5000).default([]),
  })
  .refine((value) => Boolean(value.domainId || value.domain), {
    message: 'domainId or domain is required',
    path: ['domainId'],
  });

export const UpsertAsmAssetsResponseSchema = z.object({
  domainId: z.string().uuid(),
  assetCount: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export class UpsertAsmAssetsRequestDto extends createZodDto(UpsertAsmAssetsRequestSchema) {}
export class UpsertAsmAssetsResponseDto extends createZodDto(UpsertAsmAssetsResponseSchema) {}

export type AsmAssetUpsertItemDto = z.infer<typeof AsmAssetUpsertItemSchema>;
