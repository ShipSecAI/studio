import { z } from 'zod';
import {
  componentRegistry,
  ValidationError,
  ConfigurationError,
  fromHttpResponse,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  coerceBooleanFromText,
  coerceNumberFromText,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  ipAddress: port(z.string().describe('The IPv4 or IPv6 address you want to check.'), {
    label: 'IP Address',
  }),
  apiKey: port(z.string().describe('Your AbuseIPDB API Key.'), {
    label: 'API Key',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
});

const parameterSchema = parameters({
  maxAgeInDays: param(
    coerceNumberFromText(z.number())
      .default(90)
      .describe('Max age in days for reports to be included (default: 90).'),
    {
      label: 'Max Age (Days)',
      editor: 'number',
    },
  ),
  verbose: param(coerceBooleanFromText().default(false).describe('Include verbose information.'), {
    label: 'Verbose',
    editor: 'boolean',
  }),
});

const outputSchema = outputs({
  ipAddress: port(z.string().describe('The IP address that was checked.'), {
    label: 'IP Address',
  }),
  isPublic: port(z.boolean().optional(), {
    label: 'Public IP',
    description: 'Whether the IP address is public.',
  }),
  ipVersion: port(z.number().optional(), {
    label: 'IP Version',
    description: 'IP version (4 or 6).',
  }),
  isWhitelisted: port(z.boolean().optional(), {
    label: 'Whitelisted',
  }),
  abuseConfidenceScore: port(z.number().describe('The confidence score (0-100).'), {
    label: 'Confidence Score',
  }),
  countryCode: port(z.string().optional(), {
    label: 'Country',
  }),
  usageType: port(z.string().optional(), {
    label: 'Usage Type',
    description: 'ISP usage classification from AbuseIPDB.',
  }),
  isp: port(z.string().optional(), {
    label: 'ISP',
  }),
  domain: port(z.string().optional(), {
    label: 'Domain',
    description: 'Associated domain, if available.',
  }),
  hostnames: port(z.array(z.string()).optional(), {
    label: 'Hostnames',
    description: 'Associated hostnames reported by AbuseIPDB.',
  }),
  totalReports: port(z.number().optional(), {
    label: 'Total Reports',
  }),
  numDistinctUsers: port(z.number().optional(), {
    label: 'Distinct Users',
    description: 'Number of distinct reporters.',
  }),
  lastReportedAt: port(z.string().optional(), {
    label: 'Last Reported At',
    description: 'Timestamp of the most recent report.',
  }),
  reports: port(z.array(z.record(z.string(), z.any())).optional(), {
    label: 'Reports',
    description: 'Detailed reports returned by AbuseIPDB.',
    allowAny: true,
    reason: 'Report entries vary by plan and API version.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  full_report: port(z.record(z.string(), z.any()).describe('The full raw JSON response.'), {
    label: 'Full Report',
    allowAny: true,
    reason: 'Full AbuseIPDB response payload varies by plan and API version.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

const abuseIPDBRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 4,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 120,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['AuthenticationError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'security.abuseipdb.check',
  label: 'AbuseIPDB Check',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: abuseIPDBRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Check the reputation of an IP address using the AbuseIPDB API.',
  toolProvider: {
    kind: 'component',
    name: 'abuseipdb_check',
    description: 'IP reputation and abuse report lookup (AbuseIPDB).',
  },
  ui: {
    slug: 'abuseipdb-check',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Get threat intelligence reports for an IP from AbuseIPDB.',
    icon: 'Shield',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
  },
  async execute({ inputs, params }, context) {
    const { ipAddress, apiKey } = inputs;
    const { maxAgeInDays, verbose } = params;

    if (!ipAddress) {
      throw new ValidationError('IP Address is required', {
        fieldErrors: { ipAddress: ['IP Address is required'] },
      });
    }
    if (!apiKey) {
      throw new ConfigurationError('AbuseIPDB API Key is required', {
        configKey: 'apiKey',
      });
    }

    const endpoint = 'https://api.abuseipdb.com/api/v2/check';
    const queryParams = new URLSearchParams({
      ipAddress,
      maxAgeInDays: String(maxAgeInDays),
    });
    if (verbose) {
      queryParams.append('verbose', 'true');
    }

    const url = `${endpoint}?${queryParams.toString()}`;

    context.logger.info(`[AbuseIPDB] Checking IP: ${ipAddress}`);

    const response = await context.http.fetch(url, {
      method: 'GET',
      headers: {
        Key: apiKey,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      context.logger.warn(`[AbuseIPDB] IP not found: ${ipAddress}`);
      return {
        ipAddress,
        results: [],
        abuseConfidenceScore: 0,
        full_report: { error: 'Not Found' },
      };
    }

    if (!response.ok) {
      const text = await response.text();
      throw fromHttpResponse(response, text);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const info = (data.data || {}) as Record<string, unknown>;

    const abuseConfidenceScore = info.abuseConfidenceScore as number;

    context.logger.info(`[AbuseIPDB] Score for ${ipAddress}: ${abuseConfidenceScore}`);

    // Determine severity based on abuse confidence score
    let severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none' = 'none';
    if (abuseConfidenceScore >= 90) {
      severity = 'critical';
    } else if (abuseConfidenceScore >= 70) {
      severity = 'high';
    } else if (abuseConfidenceScore >= 50) {
      severity = 'medium';
    } else if (abuseConfidenceScore >= 25) {
      severity = 'low';
    } else if (abuseConfidenceScore > 0) {
      severity = 'info';
    }

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = [
      {
        scanner: 'abuseipdb',
        finding_hash: generateFindingHash('ip-reputation', ipAddress, String(abuseConfidenceScore)),
        severity,
        asset_key: ipAddress,
        ip_address: ipAddress,
        abuse_confidence_score: abuseConfidenceScore,
        country_code: info.countryCode as string | undefined,
        isp: info.isp as string | undefined,
        total_reports: info.totalReports as number | undefined,
      },
    ];

    return {
      ipAddress: info.ipAddress as string,
      results: analyticsResults,
      isPublic: info.isPublic as boolean | undefined,
      ipVersion: info.ipVersion as number | undefined,
      isWhitelisted: info.isWhitelisted as boolean | undefined,
      abuseConfidenceScore,
      countryCode: info.countryCode as string | undefined,
      usageType: info.usageType as string | undefined,
      isp: info.isp as string | undefined,
      domain: info.domain as string | undefined,
      hostnames: info.hostnames as string[] | undefined,
      totalReports: info.totalReports as number | undefined,
      numDistinctUsers: info.numDistinctUsers as number | undefined,
      lastReportedAt: info.lastReportedAt as string | undefined,
      reports: info.reports as Record<string, unknown>[] | undefined,
      full_report: data,
    };
  },
});

componentRegistry.register(definition);

export type AbuseIPDBInput = typeof inputSchema;
export type AbuseIPDBOutput = typeof outputSchema;

export { definition };
