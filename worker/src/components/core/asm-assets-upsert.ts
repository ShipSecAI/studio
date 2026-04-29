import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  analyticsResultSchema,
  ValidationError,
} from '@shipsec/component-sdk';

import { callAssetSyncBackend } from '../../asset-discovery/runtime';

const inputSchema = inputs({
  results: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'Recon Results',
    description: 'Deduplicated ASM recon records to materialize into the ASM asset inventory.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
});

const outputSchema = outputs({
  upserted: port(z.boolean(), {
    label: 'Upserted',
    description: 'Whether assets were sent to the ASM inventory.',
  }),
  assetCount: port(z.number().int().nonnegative(), {
    label: 'Assets',
    description: 'Number of normalized assets sent to the backend.',
  }),
  created: port(z.number().int().nonnegative(), {
    label: 'Created',
    description: 'Assets created by the backend.',
  }),
  updated: port(z.number().int().nonnegative(), {
    label: 'Updated',
    description: 'Assets updated by the backend.',
  }),
  skipped: port(z.number().int().nonnegative(), {
    label: 'Skipped',
    description: 'Input records skipped because no hostname could be derived.',
  }),
});

const parameterSchema = parameters({
  domainId: param(z.string().uuid().optional().describe('ASM domain id for the scanned root.'), {
    label: 'Domain ID',
    editor: 'text',
    description: 'ASM domain id. Usually injected by the ASM scan trigger.',
  }),
  domain: param(z.string().optional().describe('ASM root domain for lookup fallback.'), {
    label: 'Domain',
    editor: 'text',
    description: 'Root domain. Used when domainId is not provided.',
  }),
  failOnError: param(
    z.boolean().default(true).describe('Fail the workflow when inventory upsert fails.'),
    {
      label: 'Fail on Error',
      editor: 'boolean',
      description: 'When disabled, inventory write failures are logged but do not fail the run.',
    },
  ),
});

type GenericRecord = Record<string, unknown>;

export interface AsmAssetUpsertPayload {
  hostname: string;
  type: string;
  ipAddresses: string[];
  techStack: string[];
  ports: { port: number; protocol: string; service: string }[];
  riskScore?: number | string;
  dnsRecords?: Record<string, unknown>;
  tlsInfo?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const toRecord = (value: unknown): GenericRecord =>
  value && typeof value === 'object' ? (value as GenericRecord) : {};

const normalizeHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripAndLower = (host: string): string | null => {
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    return normalized.length > 0 ? normalized : null;
  };

  try {
    const hostname = new URL(trimmed).hostname;
    if (hostname) return stripAndLower(hostname);
  } catch {
    // Fall through to host-like parsing.
  }

  try {
    const hostname = new URL(`http://${trimmed}`).hostname;
    if (hostname) return stripAndLower(hostname);
  } catch {
    // Fall through to conservative string parsing.
  }

  return stripAndLower(trimmed.split('/')[0] ?? trimmed);
};

const extractHost = (record: GenericRecord): string | null => {
  const candidates = [
    record.host,
    record.hostname,
    record.domain,
    record.subdomain,
    record.url,
    record.input,
    record.asset_key,
    record.target,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const host = normalizeHost(candidate);
    if (host) return host;
  }

  return null;
};

const uniqueStrings = (...values: unknown[]): string[] => {
  const byKey = new Map<string, string>();

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const text = String(value).trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, text);
    }
  };

  for (const value of values) visit(value);
  return Array.from(byKey.values());
};

const maybeRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const extractIpAddresses = (record: GenericRecord): string[] => {
  const answers = maybeRecord(record.answers);
  return uniqueStrings(
    record.ip,
    record.ips,
    record.ipAddresses,
    record.ip_addresses,
    answers?.a,
    answers?.aaaa,
  );
};

const extractTechStack = (record: GenericRecord): string[] =>
  uniqueStrings(record.technologies, record.techStack, record.tech_stack, record.webserver);

const toPortNumber = (value: unknown): number | null => {
  const port = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

const inferUrlPort = (record: GenericRecord): number | null => {
  if (typeof record.url !== 'string') return null;
  try {
    const url = new URL(record.url);
    if (url.port) return toPortNumber(url.port);
    if (url.protocol === 'https:') return 443;
    if (url.protocol === 'http:') return 80;
  } catch {
    return null;
  }
  return null;
};

const extractPorts = (record: GenericRecord): AsmAssetUpsertPayload['ports'] => {
  const ports = new Map<string, AsmAssetUpsertPayload['ports'][number]>();

  const addPort = (portValue: unknown, protocolValue?: unknown, serviceValue?: unknown) => {
    const port = toPortNumber(portValue);
    if (!port) return;
    const protocol =
      typeof protocolValue === 'string' && protocolValue.trim()
        ? protocolValue.trim().toLowerCase()
        : 'tcp';
    const service =
      typeof serviceValue === 'string' && serviceValue.trim() ? serviceValue.trim() : '';
    ports.set(`${port}:${protocol}:${service}`, { port, protocol, service });
  };

  addPort(record.port, record.protocol, record.service ?? record.webserver);

  if (Array.isArray(record.ports)) {
    for (const item of record.ports) {
      if (typeof item === 'number' || typeof item === 'string') {
        addPort(item);
        continue;
      }
      const portRecord = maybeRecord(item);
      if (portRecord) {
        addPort(portRecord.port, portRecord.protocol, portRecord.service);
      }
    }
  }

  const urlPort = inferUrlPort(record);
  if (urlPort) {
    addPort(urlPort, 'tcp', typeof record.scheme === 'string' ? record.scheme : undefined);
  }

  return Array.from(ports.values()).sort((a, b) => a.port - b.port);
};

const extractDnsRecords = (record: GenericRecord): Record<string, unknown> | undefined => {
  const answers = maybeRecord(record.answers);
  if (!answers) return undefined;
  return {
    answers,
    ...(Array.isArray(record.record_types) ? { recordTypes: record.record_types } : {}),
  };
};

const extractTlsInfo = (record: GenericRecord): Record<string, unknown> | undefined => {
  const tls =
    maybeRecord(record.tlsInfo) ?? maybeRecord(record.tls_info) ?? maybeRecord(record.tls);
  const scheme =
    typeof record.scheme === 'string'
      ? record.scheme
      : typeof record.url === 'string' && record.url.startsWith('https://')
        ? 'https'
        : undefined;

  if (tls || scheme === 'https') {
    return {
      ...(tls ?? {}),
      ...(scheme ? { scheme, observedHttps: scheme === 'https' } : {}),
    };
  }

  return undefined;
};

const extractMetadata = (record: GenericRecord): Record<string, unknown> => {
  const metadataKeys = [
    'scanner',
    'source_scanner',
    'source_scanners',
    'scanner_labels',
    'url',
    'status_code',
    'statusCode',
    'title',
    'webserver',
    'content_length',
    'contentLength',
    'finding_hash',
  ];

  return Object.fromEntries(
    metadataKeys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  );
};

export const buildAsmAssetUpserts = (results: unknown[]): AsmAssetUpsertPayload[] => {
  const assets = new Map<string, AsmAssetUpsertPayload>();

  for (const result of results) {
    const record = toRecord(result);
    const hostname = extractHost(record);
    if (!hostname) continue;

    const existing = assets.get(hostname);
    const next: AsmAssetUpsertPayload = {
      hostname,
      type: typeof record.type === 'string' && record.type.trim() ? record.type : 'subdomain',
      ipAddresses: uniqueStrings(existing?.ipAddresses, extractIpAddresses(record)),
      techStack: uniqueStrings(existing?.techStack, extractTechStack(record)),
      ports: [...(existing?.ports ?? []), ...extractPorts(record)].filter(
        (port, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.port === port.port &&
              candidate.protocol === port.protocol &&
              candidate.service === port.service,
          ) === index,
      ),
      riskScore: record.riskScore as number | string | undefined,
      dnsRecords: {
        ...(existing?.dnsRecords ?? {}),
        ...(extractDnsRecords(record) ?? {}),
      },
      tlsInfo: {
        ...(existing?.tlsInfo ?? {}),
        ...(extractTlsInfo(record) ?? {}),
      },
      metadata: {
        ...(existing?.metadata ?? {}),
        ...extractMetadata(record),
      },
    };

    if (Object.keys(next.dnsRecords ?? {}).length === 0) delete next.dnsRecords;
    if (Object.keys(next.tlsInfo ?? {}).length === 0) delete next.tlsInfo;
    if (Object.keys(next.metadata ?? {}).length === 0) delete next.metadata;

    assets.set(hostname, next);
  }

  return Array.from(assets.values());
};

const definition = defineComponent({
  id: 'core.asm.assets-upsert',
  label: 'ASM Assets Upsert',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Materialize deduplicated ASM recon records into the Postgres-backed ASM asset inventory.',
  ui: {
    slug: 'asm-assets-upsert',
    version: '1.0.0',
    type: 'output',
    category: 'output',
    description: 'Upsert deduplicated ASM recon results into the asset inventory.',
    icon: 'DatabaseZap',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute(payload: { inputs: any; params: any }, context: any) {
    const { inputs, params } = payload;
    if (!context.organizationId) {
      throw new ValidationError('ASM asset upsert requires organizationId context.');
    }

    if (!params.domainId && !params.domain) {
      throw new ValidationError('ASM asset upsert requires domainId or domain parameter.');
    }

    const assets = buildAsmAssetUpserts(inputs.results ?? []);
    if (assets.length === 0) {
      context.logger.info('[ASMAssetsUpsert] No ASM assets derived from recon results');
      return {
        upserted: false,
        assetCount: 0,
        created: 0,
        updated: 0,
        skipped: inputs.results?.length ?? 0,
      };
    }

    try {
      const result = await callAssetSyncBackend<{
        assetCount: number;
        created: number;
        updated: number;
        skipped: number;
      }>('/asm/internal/assets/upsert', {
        organizationId: context.organizationId,
        body: {
          domainId: params.domainId,
          domain: params.domain,
          runId: context.runId,
          workflowId: context.workflowId,
          assets,
        },
      });

      context.logger.info(
        `[ASMAssetsUpsert] Upserted ${result.assetCount} asset(s): created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
      );

      return {
        upserted: result.assetCount > 0,
        assetCount: result.assetCount,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error(`[ASMAssetsUpsert] Failed to upsert ASM assets: ${message}`);

      if (params.failOnError) {
        throw error;
      }

      return {
        upserted: false,
        assetCount: assets.length,
        created: 0,
        updated: 0,
        skipped: (inputs.results?.length ?? 0) - assets.length,
      };
    }
  },
});

componentRegistry.register(definition);
