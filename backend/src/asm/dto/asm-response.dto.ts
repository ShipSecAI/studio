import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// --- Base entity schemas ---

export const AsmDomainSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  domain: z.string(),
  scopeInclude: z.array(z.string()).nullable(),
  scopeExclude: z.array(z.string()).nullable(),
  monitoringEnabled: z.boolean(),
  frequency: z.string().nullable(),
  lastScanAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class AsmDomainDto extends createZodDto(AsmDomainSchema) {}

export const AsmDomainWithStatsSchema = AsmDomainSchema.extend({
  assetCount: z.number(),
});
export class AsmDomainWithStatsDto extends createZodDto(AsmDomainWithStatsSchema) {}

export const AsmDomainCreateResponseSchema = AsmDomainWithStatsSchema.extend({
  scanTriggered: z.boolean(),
  runId: z.string(),
});
export class AsmDomainCreateResponseDto extends createZodDto(AsmDomainCreateResponseSchema) {}

const AsmPortSchema = z.object({
  port: z.number(),
  protocol: z.string(),
  service: z.string(),
});

export const AsmAssetSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  domainId: z.string().uuid(),
  hostname: z.string(),
  type: z.string(),
  ipAddresses: z.array(z.string()).nullable(),
  techStack: z.array(z.string()).nullable(),
  ports: z.array(AsmPortSchema).nullable(),
  riskScore: z.string().nullable(),
  dnsRecords: z.record(z.string(), z.unknown()).nullable(),
  tlsInfo: z.record(z.string(), z.unknown()).nullable(),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export class AsmAssetDto extends createZodDto(AsmAssetSchema) {}

// --- Endpoint response schemas ---

export const AsmAssetListResponseSchema = z.object({
  assets: z.array(AsmAssetSchema),
  total: z.number(),
});
export class AsmAssetListResponseDto extends createZodDto(AsmAssetListResponseSchema) {}

export const AsmDeleteResponseSchema = z.object({
  success: z.boolean(),
});
export class AsmDeleteResponseDto extends createZodDto(AsmDeleteResponseSchema) {}

export const AsmScanTriggerResponseSchema = z.object({
  runId: z.string(),
  domain: z.string(),
});
export class AsmScanTriggerResponseDto extends createZodDto(AsmScanTriggerResponseSchema) {}

export const AsmScanListResponseSchema = z.object({
  runs: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
});
export class AsmScanListResponseDto extends createZodDto(AsmScanListResponseSchema) {}

export const AsmDashboardStatsSchema = z.object({
  domains: z.number(),
  assets: z.number(),
});
export class AsmDashboardStatsDto extends createZodDto(AsmDashboardStatsSchema) {}
