import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  port,
  analyticsResultSchema,
  type AnalyticsResult,
  generateFindingHash,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  dnsResults: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'DNS Results',
    description: 'Analytics-ready DNSx results to deduplicate and merge.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  httpResults: port(z.array(analyticsResultSchema()).optional().default([]), {
    label: 'HTTP Results',
    description: 'Analytics-ready HTTPx results that should enrich DNS discoveries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
});

const outputSchema = outputs({
  results: port(z.array(analyticsResultSchema()), {
    label: 'Deduplicated Results',
    description: 'Host-deduplicated recon results, preferring HTTP-enriched records.',
  }),
  uniqueHostCount: port(z.number().int(), {
    label: 'Unique Hosts',
    description: 'Total unique hosts after deduplication.',
  }),
  httpPreferredCount: port(z.number().int(), {
    label: 'HTTP Preferred',
    description: 'Number of hosts where HTTPx-enriched data was selected.',
  }),
  dnsOnlyCount: port(z.number().int(), {
    label: 'DNS Only',
    description: 'Number of hosts that only had DNS data.',
  }),
  droppedCount: port(z.number().int(), {
    label: 'Dropped Records',
    description: 'Records dropped because no valid host could be derived.',
  }),
});

type GenericRecord = Record<string, unknown>;

const severityValues = new Set(['critical', 'high', 'medium', 'low', 'info', 'none']);

const toRecord = (value: unknown): GenericRecord =>
  value && typeof value === 'object' ? (value as GenericRecord) : {};

const normalizeHost = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const stripAndLower = (host: string): string | null => {
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    return normalized.length > 0 ? normalized : null;
  };

  const urlTry = (() => {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return null;
    }
  })();
  if (urlTry) {
    return stripAndLower(urlTry);
  }

  const syntheticUrlTry = (() => {
    try {
      return new URL(`http://${trimmed}`).hostname;
    } catch {
      return null;
    }
  })();
  if (syntheticUrlTry) {
    return stripAndLower(syntheticUrlTry);
  }

  return stripAndLower(trimmed.split('/')[0] ?? trimmed);
};

const extractHost = (item: GenericRecord): string | null => {
  const candidates: unknown[] = [
    item.host,
    item.hostname,
    item.domain,
    item.subdomain,
    item.url,
    item.input,
    item.asset_key,
    item.target,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const host = normalizeHost(candidate);
    if (host) return host;
  }

  return null;
};

const scoreHttpRecord = (item: GenericRecord): number => {
  let score = 0;

  const url = typeof item.url === 'string' ? item.url : null;
  const scheme = typeof item.scheme === 'string' ? item.scheme.toLowerCase() : null;
  const statusCode =
    typeof item.status_code === 'number'
      ? item.status_code
      : typeof item.statusCode === 'number'
        ? item.statusCode
        : null;
  const title = typeof item.title === 'string' ? item.title : '';
  const technologies = Array.isArray(item.technologies) ? item.technologies : [];
  const contentLength =
    typeof item.content_length === 'number'
      ? item.content_length
      : typeof item.contentLength === 'number'
        ? item.contentLength
        : 0;

  if (url && url.length > 0) score += 1;
  if (scheme === 'https' || (url && url.startsWith('https://'))) score += 3;
  if (statusCode !== null) {
    score += 1;
    if (statusCode >= 200 && statusCode < 400) score += 2;
  }
  if (title.trim().length > 0) score += 1;
  if (technologies.length > 0) score += 1;
  if (contentLength > 0) score += 1;

  return score;
};

const definition = defineComponent({
  id: 'core.asm.recon-dedupe',
  label: 'ASM Recon Dedupe',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Deduplicate ASM recon assets by host and prefer HTTPx-enriched records over raw DNS-only records.',
  ui: {
    slug: 'asm-recon-dedupe',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Merge DNSx and HTTPx outputs, deduplicate hosts, and keep enriched HTTP records.',
    icon: 'Combine',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  async execute({ inputs }, context) {
    const dnsByHost = new Map<string, GenericRecord>();
    const httpByHost = new Map<string, { record: GenericRecord; score: number }>();
    let droppedCount = 0;

    for (const entry of inputs.dnsResults ?? []) {
      const record = toRecord(entry);
      const host = extractHost(record);
      if (!host) {
        droppedCount += 1;
        continue;
      }
      const existing = dnsByHost.get(host);
      if (!existing) {
        dnsByHost.set(host, record);
      } else {
        // Prefer DNS records that contain A/AAAA answers over SOA-only
        const answers = record.answers as Record<string, string[]> | undefined;
        const existingAnswers = existing.answers as Record<string, string[]> | undefined;
        const hasAddressRecords = Boolean(answers?.a?.length || answers?.aaaa?.length);
        const existingHasAddressRecords = Boolean(
          existingAnswers?.a?.length || existingAnswers?.aaaa?.length,
        );
        if (hasAddressRecords && !existingHasAddressRecords) {
          dnsByHost.set(host, record);
        }
      }
    }

    for (const entry of inputs.httpResults ?? []) {
      const record = toRecord(entry);
      const host = extractHost(record);
      if (!host) {
        droppedCount += 1;
        continue;
      }

      const score = scoreHttpRecord(record);
      const existing = httpByHost.get(host);
      if (!existing || score > existing.score) {
        httpByHost.set(host, { record, score });
      }
    }

    const allHosts = new Set<string>([...dnsByHost.keys(), ...httpByHost.keys()]);
    const dedupedResults: AnalyticsResult[] = [];
    let httpPreferredCount = 0;
    let dnsOnlyCount = 0;

    for (const host of allHosts) {
      const dnsRecord = dnsByHost.get(host);
      const httpRecord = httpByHost.get(host)?.record;
      const hasDns = Boolean(dnsRecord);
      const hasHttp = Boolean(httpRecord);

      const merged = httpRecord
        ? { ...(dnsRecord ?? {}), ...httpRecord }
        : { ...(dnsRecord ?? {}) };
      const severityRaw = merged.severity;
      const severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none' =
        typeof severityRaw === 'string' && severityValues.has(severityRaw)
          ? (severityRaw as 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none')
          : 'info';

      if (hasHttp) {
        httpPreferredCount += 1;
      } else {
        dnsOnlyCount += 1;
      }

      const scannerLabels: string[] = [];
      if (hasDns) scannerLabels.push('dnsx');
      if (hasHttp) scannerLabels.push('httpx');

      const preferredScanner = hasHttp ? 'httpx' : 'dnsx';

      // Extract IP from httpx or fall back to DNS A/AAAA records
      const mergedAnswers = merged.answers as Record<string, string[]> | undefined;
      const ip =
        (typeof merged.ip === 'string' && merged.ip) ||
        mergedAnswers?.a?.[0] ||
        mergedAnswers?.aaaa?.[0] ||
        null;

      dedupedResults.push({
        ...merged,
        ip,
        scanner: preferredScanner,
        finding_hash: generateFindingHash('asm-recon-host', host),
        severity,
        asset_key: host,
        host,
        source_scanner: preferredScanner,
        scanner_labels: scannerLabels,
        source_scanners: scannerLabels,
      });
    }

    context.logger.info(
      `[ASMReconDedupe] dns=${inputs.dnsResults.length} http=${inputs.httpResults.length} unique=${dedupedResults.length} httpPreferred=${httpPreferredCount} dnsOnly=${dnsOnlyCount} dropped=${droppedCount}`,
    );

    return {
      results: dedupedResults,
      uniqueHostCount: dedupedResults.length,
      httpPreferredCount,
      dnsOnlyCount,
      droppedCount,
    };
  },
});

componentRegistry.register(definition);
