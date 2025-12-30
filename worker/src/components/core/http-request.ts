import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  fromHttpResponse,
  TimeoutError,
  NetworkError,
  ComponentRetryPolicy,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  url: z.string().url().describe('Target URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
  body: z.string().optional().describe('Raw body content (JSON, text, etc.)'),
  contentType: z.string().default('application/json').describe('Content-Type header shorthand'),
  timeout: z.number().int().positive().default(30000).describe('Timeout in milliseconds'),
  failOnError: z.boolean().default(true).describe('Throw error on 4xx/5xx responses'),

  // Auth configuration
  authType: z.enum(['none', 'bearer', 'basic', 'custom']).default('none').describe('Authentication method'),

  // Dynamic Auth Inputs
  bearerToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  authHeaderName: z.string().optional(),
  authHeaderValue: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;

type Params = {
  authType?: 'none' | 'bearer' | 'basic' | 'custom';
};

const outputSchema = z.object({
  status: z.number(),
  statusText: z.string(),
  data: z.unknown().describe('Parsed JSON body if applicable, otherwise string'),
  headers: z.record(z.string(), z.string()),
  rawBody: z.string(),
});

type Output = z.infer<typeof outputSchema>;

// Retry policy for HTTP requests - sensible defaults for API calls
const httpRequestRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 1,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'NotFoundError',
    'ValidationError',
    'ConfigurationError',
    'PermissionError',
  ],
};

const definition: ComponentDefinition<Input, Output, Params> = {
  id: 'core.http.request',
  label: 'HTTP Request',
  category: 'transform',
  runner: { kind: 'inline' },
  retryPolicy: httpRequestRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Performs a generic HTTP request to any API endpoint. Supports all standard methods, headers, and body types.',
  metadata: {
    slug: 'http-request',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Make generic HTTP requests to external APIs.',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'url',
        label: 'URL',
        dataType: port.text(),
        required: true,
        description: 'The target API endpoint URL.',
      },
      {
        id: 'body',
        label: 'Body',
        dataType: port.text(),
        required: false,
        description: 'Request body. For JSON, ensure it is a valid JSON string.',
      },
      {
        id: 'headers',
        label: 'Headers',
        dataType: port.json(),
        required: false,
        description: 'Key-value map of HTTP headers.',
      },
    ],
    outputs: [
      {
        id: 'status',
        label: 'Status Code',
        dataType: port.number(),
        description: 'HTTP status code (e.g. 200, 404).',
      },
      {
        id: 'data',
        label: 'Response Data',
        dataType: port.json(),
        description: 'Automatically parsed JSON response body.',
      },
      {
        id: 'rawBody',
        label: 'Raw Body',
        dataType: port.text(),
        description: 'Raw string content of the response.',
      },
    ],
    examples: [
      'Call the Jira API to search for issues.',
      'Trigger a PagerDuty alert via their REST API.',
      'Fetch threat intelligence data from VirusTotal.',
    ],
    parameters: [
      {
        id: 'method',
        label: 'HTTP Method',
        type: 'select',
        default: 'GET',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' },
        ],
        required: true,
      },
      {
        id: 'contentType',
        label: 'Content Type',
        type: 'select',
        default: 'application/json',
        options: [
          { label: 'JSON (application/json)', value: 'application/json' },
          { label: 'Form URL Encoded', value: 'application/x-www-form-urlencoded' },
          { label: 'Text/Plain', value: 'text/plain' },
          { label: 'Custom', value: 'custom' },
        ],
        description: 'Sets the Content-Type header automatically.',
      },
      {
        id: 'authType',
        label: 'Authentication',
        type: 'select',
        default: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Bearer Token', value: 'bearer' },
          { label: 'Basic Auth', value: 'basic' },
          { label: 'Custom Header', value: 'custom' },
        ],
      },
      {
        id: 'timeout',
        label: 'Timeout (ms)',
        type: 'number',
        default: 30000,
        min: 1000,
        max: 60000,
      },
      {
        id: 'failOnError',
        label: 'Fail on Error',
        type: 'boolean',
        default: true,
        description: 'If true, workflow stops on 4xx/5xx errors. If false, returns status code for manual handling.',
      },
    ],
  },
  resolvePorts(params) {
    const inputs: any[] = [
      { id: 'url', label: 'URL', dataType: port.text(), required: true },
      { id: 'body', label: 'Body', dataType: port.text(), required: false },
      { id: 'headers', label: 'Headers', dataType: port.json(), required: false },
    ];

    const authType = params.authType;

    if (authType === 'bearer') {
      inputs.push({ id: 'bearerToken', label: 'Bearer Token', dataType: port.secret(), required: true });
    } else if (authType === 'basic') {
      inputs.push(
        { id: 'username', label: 'Username', dataType: port.text(), required: true },
        { id: 'password', label: 'Password', dataType: port.secret(), required: true }
      );
    } else if (authType === 'custom') {
      inputs.push(
        { id: 'authHeaderName', label: 'Header Name', dataType: port.text(), required: true },
        { id: 'authHeaderValue', label: 'Header Value', dataType: port.secret(), required: true }
      );
    }

    return { inputs };
  },
  async execute(params, context) {
    const { url, method, body, headers = {}, contentType, timeout, failOnError, authType, bearerToken, username, password, authHeaderName, authHeaderValue } = params;

    context.logger.info(`[HTTP] ${method} ${url}`);

    // Merge headers
    const finalHeaders = new Headers(headers);
    if (contentType !== 'custom' && !finalHeaders.has('Content-Type')) {
      finalHeaders.set('Content-Type', contentType);
    }

    // Handle Auth
    if (authType === 'bearer' && bearerToken) {
      finalHeaders.set('Authorization', `Bearer ${bearerToken}`);
    } else if (authType === 'basic' && username && password) {
      const b64 = btoa(`${username}:${password}`);
      finalHeaders.set('Authorization', `Basic ${b64}`);
    } else if (authType === 'custom' && authHeaderName && authHeaderValue) {
      finalHeaders.set(authHeaderName, authHeaderValue);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      context.emitProgress(`Requesting ${method} ${url}...`);

      const response = await fetch(url, {
        method: method,
        headers: finalHeaders,
        body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rawText = await response.text();
      let parsedData: unknown = rawText;

      // Try parsing JSON
      try {
        if (rawText && (response.headers.get('content-type')?.includes('application/json') || rawText.startsWith('{') || rawText.startsWith('['))) {
          parsedData = JSON.parse(rawText);
        }
      } catch {
        // Keep as text if not JSON
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });

      context.logger.info(`[HTTP] Response: ${response.status} ${response.statusText}`);

      if (failOnError && !response.ok) {
        throw fromHttpResponse(response, rawText.slice(0, 500));
      }

      return {
        status: response.status,
        statusText: response.statusText,
        data: parsedData,
        headers: responseHeaders,
        rawBody: rawText,
      };

    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new TimeoutError(
          `HTTP request timed out after ${timeout}ms`,
          timeout,
          { details: { url, method } }
        );
      }
      // Wrap network errors appropriately
      if (
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('ENETUNREACH') ||
        error.message?.includes('socket hang up') ||
        error.name === 'FetchError'
      ) {
        throw NetworkError.from(error);
      }
      throw error;
    }
  },
};

componentRegistry.register(definition);

export { definition };

export type { Input as HttpRequestInput, Output as HttpRequestOutput };
