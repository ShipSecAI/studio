import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  runComponentWithRunner,
} from '@shipsec/component-sdk';

const recordTypeEnum = z.enum([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'TXT',
  'PTR',
  'SRV',
  'SOA',
  'CAA',
  'AXFR',
  'ANY',
  'RECON',
]);

const inputSchema = z.object({
  domains: z
    .array(
      z
        .string()
        .min(1)
        .regex(/^[\w.-]+$/, 'Domains may only include letters, numbers, dots, underscores, and hyphens.'),
    )
    .min(1, 'Provide at least one domain to resolve.'),
  recordTypes: z.array(recordTypeEnum).default(['A']),
  resolvers: z
    .array(
      z
        .string()
        .min(1, 'Resolver addresses cannot be empty.')
        .regex(
          /^[\w.:+-]+$/,
          'Resolvers should be hostnames or IPs, optionally including port (e.g. 1.1.1.1:53).',
        ),
    )
    .default([]),
  retryCount: z.number().int().min(1).max(10).default(2),
  rateLimit: z.number().int().positive().max(10000).optional(),
});

type Input = z.infer<typeof inputSchema>;

type DnsxRecord = {
  host: string;
  statusCode?: string;
  ttl?: number;
  resolver?: string[];
  answers: Record<string, string[]>;
  timestamp?: string;
};

type Output = {
  results: DnsxRecord[];
  rawOutput: string;
  domainCount: number;
  recordCount: number;
  recordTypes: string[];
  resolvers: string[];
  errors?: string[];
};

const dnsxLineSchema = z
  .object({
    host: z.string(),
    status_code: z.string().optional(),
    ttl: z.union([z.number(), z.string()]).optional(),
    resolver: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
    raw_resp: z.unknown().optional(),
  })
  .passthrough();

const outputSchema: z.ZodType<Output> = z.object({
  results: z.array(z.any()),
  rawOutput: z.string(),
  domainCount: z.number(),
  recordCount: z.number(),
  recordTypes: z.array(z.string()),
  resolvers: z.array(z.string()),
  errors: z.array(z.string()).optional(),
}) as z.ZodType<Output>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.dnsx.run',
  label: 'DNSX Resolver',
  category: 'discovery',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/dnsx:latest',
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: 180,
    env: {
      HOME: '/root',
    },
    command: [
      '-c',
      String.raw`set -eo pipefail

INPUT=$(cat)

DOMAINS_BLOCK=$(printf '%s' "$INPUT" | sed -n 's/.*"domains":\[\([^]]*\)\].*/\1/p')

if [ -z "$DOMAINS_BLOCK" ]; then
  printf '{"results":[],"rawOutput":"","domainCount":0,"recordCount":0,"recordTypes":[],"resolvers":[],"errors":["No domains provided"]}'
  exit 0
fi

DOMAIN_FILE=$(mktemp)
RAW_FILE=$(mktemp)
ERR_FILE=$(mktemp)
trap 'rm -f "$DOMAIN_FILE" "$RAW_FILE" "$ERR_FILE" $RESOLVER_FILE' EXIT

printf '%s' "$DOMAINS_BLOCK" | tr -d '"' | tr ',' '\n' | sed '/^$/d' > "$DOMAIN_FILE"
DOMAIN_COUNT=$(wc -l < "$DOMAIN_FILE" | tr -d ' ')

RECORD_TYPES_BLOCK=$(printf '%s' "$INPUT" | sed -n 's/.*"recordTypes":\[\([^]]*\)\].*/\1/p')
RESOLVERS_BLOCK=$(printf '%s' "$INPUT" | sed -n 's/.*"resolvers":\[\([^]]*\)\].*/\1/p')
RETRY_COUNT=$(printf '%s' "$INPUT" | sed -n 's/.*"retryCount":\([0-9]*\).*/\1/p')
RATE_LIMIT=$(printf '%s' "$INPUT" | sed -n 's/.*"rateLimit":\([0-9]*\).*/\1/p')

RECORD_TYPES_BLOCK=\${RECORD_TYPES_BLOCK:-A}

RECORD_TYPES_LINE=$(printf '%s' "$RECORD_TYPES_BLOCK" | tr -d '"' | tr ',' ' ')
RESOLVERS_LINE=$(printf '%s' "$RESOLVERS_BLOCK" | tr -d '"' | tr ',' ' ')

RECORD_TYPES_JSON='[]'
if [ -n "$RECORD_TYPES_LINE" ]; then
  RECORD_TYPES_JSON='['
  SEP=''
  for RTYPE in $RECORD_TYPES_LINE; do
    CLEAN=$(printf '%s' "$RTYPE" | sed 's/"/\\"/g')
    RECORD_TYPES_JSON="\${RECORD_TYPES_JSON}\${SEP}\"\${CLEAN}\""
    SEP=','
  done
  RECORD_TYPES_JSON="\${RECORD_TYPES_JSON}]"
else
  RECORD_TYPES_JSON='["A"]'
  RECORD_TYPES_LINE='A'
fi

RESOLVERS_JSON='[]'
if [ -n "$RESOLVERS_LINE" ]; then
  RESOLVER_FILE=$(mktemp)
  echo -n > "$RESOLVER_FILE"
  RESOLVERS_JSON='['
  SEP=''
  for RES in $RESOLVERS_LINE; do
    CLEAN=$(printf '%s' "$RES" | sed 's/"/\\"/g')
    printf '%s\n' "$RES" >> "$RESOLVER_FILE"
    RESOLVERS_JSON="\${RESOLVERS_JSON}\${SEP}\"\${CLEAN}\""
    SEP=','
  done
  RESOLVERS_JSON="\${RESOLVERS_JSON}]"
fi

set -- -json -resp -silent -l "$DOMAIN_FILE"

if [ -n "$RESOLVERS_LINE" ]; then
  set -- "$@" -r "$RESOLVER_FILE"
fi

if [ -n "$RETRY_COUNT" ] && [ "$RETRY_COUNT" -ge 1 ]; then
  set -- "$@" -retry "$RETRY_COUNT"
fi

if [ -n "$RATE_LIMIT" ] && [ "$RATE_LIMIT" -ge 1 ]; then
  set -- "$@" -rl "$RATE_LIMIT"
fi

for TYPE in $RECORD_TYPES_LINE; do
  case "$TYPE" in
    A|a) set -- "$@" -a ;;
    AAAA|aaaa) set -- "$@" -aaaa ;;
    CNAME|cname) set -- "$@" -cname ;;
    MX|mx) set -- "$@" -mx ;;
    NS|ns) set -- "$@" -ns ;;
    TXT|txt) set -- "$@" -txt ;;
    PTR|ptr) set -- "$@" -ptr ;;
    SRV|srv) set -- "$@" -srv ;;
    SOA|soa) set -- "$@" -soa ;;
    CAA|caa) set -- "$@" -caa ;;
    AXFR|axfr) set -- "$@" -axfr ;;
    ANY|any) set -- "$@" -any ;;
    RECON|recon) set -- "$@" -recon ;;
  esac
done

if ! dnsx "$@" > "$RAW_FILE" 2> "$ERR_FILE"; then
  ERROR_MSG=$(sed ':a;N;$!ba;s/\n/\\n/g; s/"/\\"/g' "$ERR_FILE")
  printf '{"__error__":true,"message":"%s","domainCount":%d,"recordTypes":%s,"resolvers":%s}' "$ERROR_MSG" "$DOMAIN_COUNT" "$RECORD_TYPES_JSON" "$RESOLVERS_JSON"
  exit 0
fi

if [ -s "$RAW_FILE" ]; then
  cat "$RAW_FILE"
else
  printf ''
fi
`,
    ],
  },
  inputSchema,
  outputSchema,
  docs:
    'Executes dnsx inside Docker to resolve DNS records for the provided domains. Supports multiple record types, custom resolvers, and rate limiting.',
  metadata: {
    slug: 'dnsx',
    version: '1.0.0',
    type: 'scan',
    category: 'security-tool',
    description:
      'Resolve DNS records using ProjectDiscovery dnsx with support for multiple record types, custom resolvers, and rate limiting.',
    documentation: 'https://github.com/projectdiscovery/dnsx',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'domains',
        label: 'Target Domains',
        type: 'array',
        required: true,
        description: 'Array of domains or hostnames to resolve.',
      },
      {
        id: 'recordTypes',
        label: 'Record Types',
        type: 'array',
        description: 'DNS record types to query (e.g. A, AAAA, CNAME).',
      },
      {
        id: 'resolvers',
        label: 'Resolvers',
        type: 'array',
        description: 'Optional resolver IPs/hosts (e.g. 1.1.1.1:53).',
      },
    ],
    outputs: [
      {
        id: 'results',
        label: 'DNS Responses',
        type: 'array',
        description: 'Structured dnsx JSONL output grouped by record type.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        type: 'string',
        description: 'Raw dnsx JSONL output prior to normalisation.',
      },
    ],
    parameters: [
      {
        id: 'retryCount',
        label: 'Retry Count',
        type: 'number',
        default: 2,
        min: 1,
        max: 10,
        description: 'Number of retry attempts dnsx should make for failed queries.',
      },
      {
        id: 'rateLimit',
        label: 'Rate Limit (req/s)',
        type: 'number',
        description: 'Throttle dnsx requests per second (optional).',
        min: 1,
        max: 10000,
      },
    ],
  },
  async execute(input, context) {
    const { domains, recordTypes, resolvers, retryCount, rateLimit } = input;

    context.logger.info(
      `[DNSX] Resolving ${domains.length} domain(s) with record types: ${recordTypes.join(', ')}`,
    );
    context.emitProgress(
      `Running dnsx for ${domains.length} domain${domains.length > 1 ? 's' : ''}`,
    );

    const runnerInput = {
      domains,
      recordTypes,
      resolvers,
      retryCount,
      rateLimit,
    };

    let rawResult = await runComponentWithRunner(
      this.runner,
      async () => ({} as Output),
      runnerInput,
      context,
    );

    if (
      rawResult &&
      typeof rawResult === 'object' &&
      !Array.isArray(rawResult)
    ) {
      const record = rawResult as Record<string, unknown>;
      const appearsNormalised =
        Object.prototype.hasOwnProperty.call(record, 'results') &&
        Object.prototype.hasOwnProperty.call(record, 'rawOutput');

      if (!appearsNormalised) {
        try {
          rawResult = JSON.stringify(record);
        } catch {
          rawResult = '';
        }
      }
    }

    if (rawResult === undefined || rawResult === null) {
      rawResult = '';
    }

    const ensureUnique = (values: string[]) =>
      Array.from(new Set(values.filter((value) => value && value.length > 0)));

    const buildOutput = (params: {
      records: Array<z.infer<typeof dnsxLineSchema>>;
      rawOutput: string;
      domainCount: number;
      recordCount: number;
      recordTypes: string[];
      resolvers: string[];
      errors?: string[];
    }): Output => {
      const normalisedRecords: DnsxRecord[] = params.records.map((record) => {
        const answers: Record<string, string[]> = {};
        const candidateKeys = [
          'a',
          'aaaa',
          'cname',
          'mx',
          'ns',
          'txt',
          'ptr',
          'srv',
          'soa',
          'caa',
          'any',
          'axfr',
          'all',
        ];

        candidateKeys.forEach((key: string) => {
          const value = (record as Record<string, unknown>)[key];
          if (Array.isArray(value) && value.length > 0) {
            answers[key] = value.map((entry: unknown) => String(entry));
          }
        });

        const ttlValue = (record as Record<string, unknown>).ttl;
        const ttl =
          typeof ttlValue === 'number'
            ? ttlValue
            : typeof ttlValue === 'string' && ttlValue.trim().length > 0
              ? Number.parseInt(ttlValue, 10)
              : undefined;

        return {
          host: record.host,
          statusCode: typeof (record as Record<string, unknown>).status_code === 'string'
            ? (record as Record<string, unknown>).status_code as string
            : undefined,
          ttl: Number.isFinite(ttl) ? ttl : undefined,
          resolver: Array.isArray(record.resolver)
            ? record.resolver.map((entry: unknown) => String(entry))
            : undefined,
          answers,
          timestamp: record.timestamp,
        };
      });

      const derivedResolvers = ensureUnique(
        params.records
          .flatMap((record) => (Array.isArray(record.resolver) ? record.resolver.map((entry) => String(entry)) : [])),
      );

      const derivedRecordTypes = ensureUnique(
        params.records.flatMap((record) => {
          const keys: string[] = [];
          const candidateKeys = ['a', 'aaaa', 'cname', 'mx', 'ns', 'txt', 'ptr', 'srv', 'soa', 'caa', 'any', 'axfr'];
          candidateKeys.forEach((key) => {
            const value = (record as Record<string, unknown>)[key];
            if (Array.isArray(value) && value.length > 0) {
              keys.push(key.toUpperCase());
            }
          });
          return keys;
        }),
      );

      const requestedRecordTypes = Array.isArray(params.recordTypes)
        ? params.recordTypes.filter((entry) => typeof entry === 'string')
        : [];

      const requestedResolvers = Array.isArray(params.resolvers)
        ? params.resolvers.filter((entry) => typeof entry === 'string')
        : [];

      return {
        results: normalisedRecords,
        rawOutput: params.rawOutput,
        domainCount: params.domainCount,
        recordCount: params.recordCount,
        recordTypes: ensureUnique(
          requestedRecordTypes.length > 0
            ? requestedRecordTypes
            : derivedRecordTypes.length > 0
              ? derivedRecordTypes
              : recordTypes,
        ),
        resolvers: ensureUnique(
          requestedResolvers.length > 0
            ? requestedResolvers
            : derivedResolvers.length > 0
              ? derivedResolvers
              : resolvers,
        ),
        errors: params.errors && params.errors.length > 0 ? ensureUnique(params.errors) : undefined,
      };
    };

    if (typeof rawResult === 'string') {
      const rawOutput = rawResult;
      const trimmed = rawOutput.trim();

      if (trimmed.length === 0) {
        return {
          results: [],
          rawOutput,
          domainCount: domains.length,
          recordCount: 0,
          recordTypes,
          resolvers,
        };
      }

      const lines = trimmed
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const parseErrors: string[] = [];
      const parsedRecords: Array<z.infer<typeof dnsxLineSchema>> = [];

      for (const line of lines) {
        try {
          const parsedLine = JSON.parse(line) as Record<string, unknown>;
          if (parsedLine && parsedLine.__error__ === true) {
            const message =
              typeof parsedLine.message === 'string'
                ? parsedLine.message
                : 'dnsx returned an error without details.';
            parseErrors.push(message);
            continue;
          }

          const validation = dnsxLineSchema.safeParse(parsedLine);
          if (validation.success) {
            parsedRecords.push(validation.data);
          } else {
            parseErrors.push(validation.error.message);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          parseErrors.push(`Failed to parse dnsx output line: ${reason}`);
        }
      }

      if (parsedRecords.length === 0) {
        context.logger.error('[DNSX] No valid JSON lines returned from dnsx; falling back to raw output.');
        const fallbackLines = lines.length > 0 ? lines : trimmed.split('\n');
        const fallbackResults: DnsxRecord[] = fallbackLines.map((line) => ({
          host: line,
          answers: { raw: [line] },
        }));

        return {
          results: fallbackResults,
          rawOutput,
          domainCount: domains.length,
          recordCount: fallbackResults.length,
          recordTypes,
          resolvers,
          errors:
            parseErrors.length > 0
              ? parseErrors
              : ['dnsx output was not valid JSON; returned raw lines.'],
        };
      }

      return buildOutput({
        records: parsedRecords,
        rawOutput,
        domainCount: domains.length,
        recordCount: parsedRecords.length,
        recordTypes,
        resolvers,
        errors: parseErrors,
      });
    }

    const safeResult = outputSchema.safeParse(rawResult);

    if (!safeResult.success) {
      context.logger.error(`[DNSX] Output validation failed: ${safeResult.error.message}`);

      const rawOutput =
        typeof rawResult === 'string'
          ? rawResult
          : JSON.stringify(rawResult, null, 2).slice(0, 5000);

      return {
        results: [],
        rawOutput,
        domainCount: domains.length,
        recordCount: 0,
        recordTypes,
        resolvers,
        errors: ['dnsx output failed schema validation.'],
      };
    }

    return buildOutput({
      records: safeResult.data.results as Array<z.infer<typeof dnsxLineSchema>>,
      rawOutput: safeResult.data.rawOutput,
      domainCount: safeResult.data.domainCount ?? domains.length,
      recordCount: safeResult.data.recordCount ?? safeResult.data.results.length,
      recordTypes: safeResult.data.recordTypes,
      resolvers: safeResult.data.resolvers,
      errors: safeResult.data.errors,
    });
  },
};

componentRegistry.register(definition);
