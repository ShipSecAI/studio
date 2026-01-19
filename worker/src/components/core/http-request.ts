import { z } from 'zod';
import {
  componentRegistry,
  fromHttpResponse,
  TimeoutError,
  NetworkError,
  ComponentRetryPolicy,
  DEFAULT_SENSITIVE_HEADERS,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  withPortMeta,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  url: port(z.string().url().describe('Target URL'), {
    label: 'URL',
    description: 'Target URL for the request.',
  }),
  headers: port(z.record(z.string(), z.string()).optional().describe('HTTP headers'), {
    label: 'Headers',
    description: 'HTTP headers to include with the request.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  body: port(z.string().optional().describe('Raw body content (JSON, text, etc.)'), {
    label: 'Body',
    description: 'Raw request body content.',
  }),
});

const parameterSchema = parameters({
  method: param(
    z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
    {
      label: 'HTTP Method',
      editor: 'select',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'PATCH', value: 'PATCH' },
        { label: 'DELETE', value: 'DELETE' },
        { label: 'HEAD', value: 'HEAD' },
        { label: 'OPTIONS', value: 'OPTIONS' },
      ],
    },
  ),
  contentType: param(
    z.string().default('application/json').describe('Content-Type header shorthand'),
    {
      label: 'Content Type',
      editor: 'select',
      options: [
        { label: 'JSON (application/json)', value: 'application/json' },
        { label: 'Form URL Encoded', value: 'application/x-www-form-urlencoded' },
        { label: 'Text/Plain', value: 'text/plain' },
        { label: 'Custom', value: 'custom' },
      ],
      description: 'Sets the Content-Type header automatically.',
    },
  ),
  authType: param(
    z.enum(['none', 'bearer', 'basic', 'custom']).default('none').describe('Authentication method'),
    {
      label: 'Authentication',
      editor: 'select',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Bearer Token', value: 'bearer' },
        { label: 'Basic Auth', value: 'basic' },
        { label: 'Custom Header', value: 'custom' },
      ],
    },
  ),
  timeout: param(z.number().int().positive().default(30000).describe('Timeout in milliseconds'), {
    label: 'Timeout (ms)',
    editor: 'number',
    min: 1000,
    max: 60000,
  }),
  failOnError: param(z.boolean().default(true).describe('Throw error on 4xx/5xx responses'), {
    label: 'Fail on Error',
    editor: 'boolean',
    description:
      'If true, workflow stops on 4xx/5xx errors. If false, returns status code for manual handling.',
  }),
});

const outputSchema = outputs({
  status: port(z.number(), {
    label: 'Status Code',
    description: 'HTTP status code (e.g. 200, 404).',
  }),
  statusText: port(z.string(), {
    label: 'Status Text',
    description: 'HTTP status text returned by the server.',
  }),
  data: port(z.unknown().describe('Parsed JSON body if applicable, otherwise string'), {
    label: 'Response Data',
    description: 'Automatically parsed JSON response body.',
    allowAny: true,
    reason: 'HTTP response bodies can be any JSON-compatible shape.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  headers: port(z.record(z.string(), z.string()), {
    label: 'Headers',
    description: 'Response headers returned by the server.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  rawBody: port(z.string(), {
    label: 'Raw Body',
    description: 'Raw string content of the response.',
  }),
});

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

const definition = defineComponent({
  id: 'core.http.request',
  label: 'HTTP Request',
  category: 'transform',
  runner: { kind: 'inline' },
  retryPolicy: httpRequestRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Performs a generic HTTP request to any API endpoint. Supports all standard methods, headers, and body types.',
  ui: {
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
    examples: [
      'Call the Jira API to search for issues.',
      'Trigger a PagerDuty alert via their REST API.',
      'Fetch threat intelligence data from VirusTotal.',
    ],
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {
      url: withPortMeta(z.string().url(), {
        label: 'URL',
        description: 'The target API endpoint URL.',
      }),
      body: withPortMeta(z.string().optional(), {
        label: 'Body',
        description: 'Request body. For JSON, ensure it is a valid JSON string.',
      }),
      headers: withPortMeta(z.record(z.string(), z.string()).optional(), {
        label: 'Headers',
        description: 'Key-value map of HTTP headers.',
        connectionType: { kind: 'primitive', name: 'json' },
      }),
    };

    const authType = params.authType;

    if (authType === 'bearer') {
      inputShape.bearerToken = withPortMeta(z.unknown(), {
        label: 'Bearer Token',
        editor: 'secret',
        allowAny: true,
        reason: 'Bearer tokens can be provided as raw strings or resolved secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      });
    } else if (authType === 'basic') {
      inputShape.username = withPortMeta(z.string(), {
        label: 'Username',
      });
      inputShape.password = withPortMeta(z.unknown(), {
        label: 'Password',
        editor: 'secret',
        allowAny: true,
        reason: 'Passwords can be provided as raw strings or resolved secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      });
    } else if (authType === 'custom') {
      inputShape.authHeaderName = withPortMeta(z.string(), {
        label: 'Header Name',
      });
      inputShape.authHeaderValue = withPortMeta(z.unknown(), {
        label: 'Header Value',
        editor: 'secret',
        allowAny: true,
        reason: 'Custom auth headers can be provided as raw strings or resolved secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      });
    }

    return { inputs: inputs(inputShape) };
  },
  async execute({ inputs, params }, context) {
    const { method, contentType, timeout, failOnError, authType } = params;
    const { url, body, headers = {} } = inputs;
    const dynamicInputs = inputs as Record<string, unknown>;
    const authHeaderNameValue =
      typeof dynamicInputs.authHeaderName === 'string' ? dynamicInputs.authHeaderName : undefined;
    const authHeaderValueValue =
      typeof dynamicInputs.authHeaderValue === 'string' ? dynamicInputs.authHeaderValue : undefined;

    context.logger.info(`[HTTP] ${method} ${url}`);

    // Merge headers
    const finalHeaders = new Headers(headers);
    if (contentType !== 'custom' && !finalHeaders.has('Content-Type')) {
      finalHeaders.set('Content-Type', contentType);
    }

    // Handle Auth
    if (authType === 'bearer' && dynamicInputs.bearerToken) {
      finalHeaders.set('Authorization', `Bearer ${dynamicInputs.bearerToken}`);
    } else if (authType === 'basic' && dynamicInputs.username && dynamicInputs.password) {
      const b64 = btoa(`${dynamicInputs.username}:${dynamicInputs.password}`);
      finalHeaders.set('Authorization', `Basic ${b64}`);
    } else if (authType === 'custom' && authHeaderNameValue && authHeaderValueValue) {
      finalHeaders.set(authHeaderNameValue, authHeaderValueValue);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      context.emitProgress(`Requesting ${method} ${url}...`);

      const sensitiveHeaders = authHeaderNameValue
        ? Array.from(new Set([...DEFAULT_SENSITIVE_HEADERS, authHeaderNameValue]))
        : DEFAULT_SENSITIVE_HEADERS;

      const response = await context.http.fetch(
        url,
        {
          method: method,
          headers: finalHeaders,
          body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
          signal: controller.signal,
        },
        { sensitiveHeaders },
      );

      clearTimeout(timeoutId);

      const rawText = await response.text();
      let parsedData: unknown = rawText;

      // Try parsing JSON
      try {
        if (
          rawText &&
          (response.headers.get('content-type')?.includes('application/json') ||
            rawText.startsWith('{') ||
            rawText.startsWith('['))
        ) {
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
        throw new TimeoutError(`HTTP request timed out after ${timeout}ms`, timeout, {
          details: { url, method },
        });
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
});

componentRegistry.register(definition);

export { definition };

// export type { Input as HttpRequestInput, Output as HttpRequestOutput };
