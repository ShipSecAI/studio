import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  ValidationError,
  ConfigurationError,
  fromHttpResponse,
  ComponentRetryPolicy,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  indicator: z.string().describe('The IP, Domain, File Hash, or URL to inspect.'),
  type: z.enum(['ip', 'domain', 'file', 'url']).default('ip').describe('The type of indicator.'),
  apiKey: z.string().describe('Your VirusTotal API Key.'),
});

const outputSchema = z.object({
  malicious: z.number().describe('Number of engines flagging this as malicious.'),
  suspicious: z.number().describe('Number of engines flagging this as suspicious.'),
  harmless: z.number().describe('Number of engines flagging this as harmless.'),
  tags: z.array(z.string()).optional(),
  reputation: z.number().optional(),
  full_report: z.record(z.string(), z.any()).describe('The full raw JSON response from VirusTotal.'),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

// Retry policy for VirusTotal API - handles rate limits and transient failures
const virusTotalRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 4,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 120,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'ValidationError',
    'ConfigurationError',
  ],
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'security.virustotal.lookup',
  label: 'VirusTotal Lookup',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: virusTotalRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Check the reputation of an IP, Domain, File Hash, or URL using the VirusTotal v3 API.',
  metadata: {
    slug: 'virustotal-lookup',
    version: '1.0.0',
    type: 'scan', 
    category: 'security',
    description: 'Get threat intelligence reports for IOCs from VirusTotal.',
    icon: 'Shield', // We can update this if there's a better one, or generic Shield
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    inputs: [
      { id: 'indicator', label: 'Indicator', dataType: port.text(), required: true },
      { id: 'apiKey', label: 'API Key', dataType: port.secret(), required: true },
    ],
    outputs: [
      { id: 'malicious', label: 'Malicious Count', dataType: port.number() },
      { id: 'reputation', label: 'Reputation', dataType: port.number() },
      { id: 'full_report', label: 'Full Report', dataType: port.json() },
    ],
    parameters: [
       {
        id: 'type',
        label: 'Indicator Type',
        type: 'select',
        default: 'ip',
        options: [
          { label: 'IP Address', value: 'ip' },
          { label: 'Domain', value: 'domain' },
          { label: 'File Hash (MD5/SHA1/SHA256)', value: 'file' },
          { label: 'URL', value: 'url' },
        ],
      },
    ],
  },
  resolvePorts(params) {
      return {
          inputs: [
              { id: 'indicator', label: 'Indicator', dataType: port.text(), required: true },
              { id: 'apiKey', label: 'API Key', dataType: port.secret(), required: true }
          ],
          outputs: [
              { id: 'malicious', label: 'Malicious Count', dataType: port.number() },
              { id: 'reputation', label: 'Reputation', dataType: port.number() },
              { id: 'full_report', label: 'Full Report', dataType: port.json() },
          ]
      };
  },
  async execute(params, context) {
    const { indicator, type, apiKey } = params;

    if (!indicator) {
      throw new ValidationError('Indicator is required', {
        fieldErrors: { indicator: ['Indicator is required'] },
      });
    }
    if (!apiKey) {
      throw new ConfigurationError('VirusTotal API Key is required', {
        configKey: 'apiKey',
      });
    }

    let endpoint = '';
    
    // API v3 Base URL
    const baseUrl = 'https://www.virustotal.com/api/v3';

    // Construct endpoint based on type
    switch (type) {
      case 'ip':
        endpoint = `${baseUrl}/ip_addresses/${indicator}`;
        break;
      case 'domain':
        endpoint = `${baseUrl}/domains/${indicator}`;
        break;
      case 'file':
        endpoint = `${baseUrl}/files/${indicator}`;
        break;
      case 'url':
        // URL endpoints usually require the URL to be base64 encoded without padding
        const b64Url = Buffer.from(indicator).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        endpoint = `${baseUrl}/urls/${b64Url}`;
        break;
    }

    context.logger.info(`[VirusTotal] Checking ${type}: ${indicator}`);

    // If type is URL, we might need to "scan" it first if it hasn't been seen, 
    // but typically "lookup" implies retrieving existing info. 
    // The GET endpoint retrieves the last analysis.

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-apikey': apiKey,
        'Accept': 'application/json'
      }
    });

    if (response.status === 404) {
      context.logger.warn(`[VirusTotal] Indicator not found: ${indicator}`);
      // Return neutral/zero stats if not found, or maybe just the error?
      // Usually "not found" fits the schema if we return zeros.
      return {
        malicious: 0,
        suspicious: 0,
        harmless: 0,
        tags: [],
        full_report: { error: 'Not Found in VirusTotal' }
      };
    }

    if (!response.ok) {
       const text = await response.text();
       throw fromHttpResponse(response, text);
    }

    const data = await response.json() as any;
    const attrs = data.data?.attributes || {};
    const stats = attrs.last_analysis_stats || {};

    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const harmless = stats.harmless || 0;
    const tags = attrs.tags || [];
    const reputation = attrs.reputation || 0;

    context.logger.info(`[VirusTotal] Results for ${indicator}: ${malicious} malicious, ${suspicious} suspicious.`);

    return {
      malicious,
      suspicious,
      harmless,
      tags,
      reputation,
      full_report: data,
    };
  },
};

componentRegistry.register(definition);

export { definition };
