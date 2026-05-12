import { z } from 'zod';
import {
  analyticsResultSchema,
  componentRegistry,
  defineComponent,
  generateFindingHash,
  inputs,
  outputs,
  param,
  parameters,
  port,
  type AnalyticsResult,
} from '@shipsec/component-sdk';

const CSP_HEADER = 'content-security-policy';
const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only';

const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info', 'none']);

const cspDirectiveSchema = z.record(z.string(), z.array(z.string()));

const cspFindingSchema = z.object({
  url: z.string(),
  checkId: z.string(),
  title: z.string(),
  severity: severitySchema,
  headerName: z.string().nullable(),
  directive: z.string().nullable(),
  value: z.string().nullable(),
  description: z.string(),
  remediation: z.string(),
});

type CspFinding = z.infer<typeof cspFindingSchema>;
type Severity = z.infer<typeof severitySchema>;

const checkedTargetSchema = z.object({
  url: z.string(),
  status: z.number().nullable(),
  headers: z.record(z.string(), z.string()),
  policy: cspDirectiveSchema.nullable(),
  reportOnlyPolicy: cspDirectiveSchema.nullable(),
  error: z.string().nullable(),
});

const inputSchema = inputs({
  targets: port(z.array(z.string().url()).default([]), {
    label: 'Target URLs',
    description: 'URLs to fetch and check for Content-Security-Policy coverage.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  url: port(z.string().url().optional(), {
    label: 'Response URL',
    description:
      'Optional single URL for analyzing headers from an upstream HTTP Request component.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  headers: port(z.record(z.string(), z.string()).optional(), {
    label: 'Response Headers',
    description:
      'Optional response headers from an upstream HTTP Request component. If provided with URL, no network request is made.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  method: param(z.enum(['GET', 'HEAD']).default('GET'), {
    label: 'Fetch Method',
    editor: 'select',
    description: 'HTTP method used when fetching target URLs directly.',
    options: [
      { label: 'GET', value: 'GET' },
      { label: 'HEAD', value: 'HEAD' },
    ],
  }),
  timeoutMs: param(z.number().int().min(1000).max(60000).default(10000), {
    label: 'Timeout (ms)',
    editor: 'number',
    min: 1000,
    max: 60000,
    description: 'Per-target request timeout when fetching target URLs.',
  }),
  userAgent: param(z.string().trim().min(1).default('ShipSecAI-CSP-Checks/1.0'), {
    label: 'User Agent',
    editor: 'text',
    description: 'User-Agent header used when fetching target URLs.',
  }),
  includeReportOnly: param(z.boolean().default(true), {
    label: 'Include Report-Only',
    editor: 'boolean',
    description: 'Analyze Content-Security-Policy-Report-Only when no enforced CSP is present.',
  }),
  maxTargets: param(z.number().int().min(1).max(100).default(25), {
    label: 'Max Targets',
    editor: 'number',
    min: 1,
    max: 100,
    description: 'Maximum number of target URLs to fetch in one run.',
  }),
});

const outputSchema = outputs({
  findings: port(z.array(cspFindingSchema), {
    label: 'CSP Findings',
    description: 'Content-Security-Policy issues and hardening recommendations.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  checkedTargets: port(z.array(checkedTargetSchema), {
    label: 'Checked Targets',
    description: 'Headers, parsed policy, and fetch status for each target.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'JSON summary of checked targets and findings.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets checked.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Number of CSP findings returned.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

type InputShape = z.infer<typeof inputSchema>;
type OutputShape = z.infer<typeof outputSchema>;
type Params = z.infer<typeof parameterSchema>;

const definition = defineComponent({
  id: 'shipsec.csp.check',
  label: 'CSP Checks',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Checks Content-Security-Policy headers for missing policies and risky directives such as unsafe-inline, unsafe-eval, wildcard sources, and missing object-src/base-uri/frame-ancestors hardening.',
  ui: {
    slug: 'csp-checks',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Audit HTTP response headers for CSP coverage and risky directive values.',
    documentation:
      'Provide target URLs directly or connect headers from the HTTP Request component. The component parses enforced and report-only CSP headers and emits security findings.',
    documentationUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Check live URLs discovered by httpx before routing risky policies into the analytics sink.',
      'Analyze response headers fetched by the HTTP Request component without making another request.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    const checkedTargets: z.infer<typeof checkedTargetSchema>[] = [];

    if (parsedInputs.url && parsedInputs.headers) {
      const headers = normalizeHeaders(parsedInputs.headers);
      checkedTargets.push(createCheckedTarget(parsedInputs.url, null, headers, null));
    }

    const targets = normalizeTargets(parsedInputs).slice(0, parsedParams.maxTargets);
    for (const target of targets) {
      context.emitProgress(`Checking CSP for ${target}`);
      checkedTargets.push(await fetchTargetHeaders(target, parsedParams, context));
    }

    if (checkedTargets.length === 0) {
      context.logger.info(
        '[CSP] Skipping check because no targets or response headers were provided.',
      );
    } else {
      context.logger.info(`[CSP] Checked ${checkedTargets.length} target(s).`);
    }

    const findings = checkedTargets.flatMap((target) =>
      evaluateCspHeaders(target.url, target.headers, {
        includeReportOnly: parsedParams.includeReportOnly,
        fetchError: target.error,
      }),
    );

    const output: OutputShape = {
      findings,
      checkedTargets,
      rawOutput: JSON.stringify({ checkedTargets, findings }, null, 2),
      targetCount: checkedTargets.length,
      findingCount: findings.length,
      results: createAnalyticsResults(findings),
    };

    return outputSchema.parse(output);
  },
});

function normalizeTargets(inputs: InputShape): string[] {
  const targets = new Set<string>();

  for (const target of inputs.targets ?? []) {
    const trimmed = target.trim();
    if (trimmed.length > 0) targets.add(trimmed);
  }

  if (inputs.url && !inputs.headers) {
    targets.add(inputs.url);
  }

  return [...targets];
}

async function fetchTargetHeaders(
  url: string,
  params: Params,
  context: any,
): Promise<z.infer<typeof checkedTargetSchema>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await context.http.fetch(url, {
      method: params.method,
      redirect: 'follow',
      headers: {
        'User-Agent': params.userAgent,
      },
      signal: controller.signal,
    });

    return createCheckedTarget(url, response.status, headersToObject(response.headers), null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createCheckedTarget(url, null, {}, message || 'Failed to fetch target.');
  } finally {
    clearTimeout(timeout);
  }
}

function createCheckedTarget(
  url: string,
  status: number | null,
  headers: Record<string, string>,
  error: string | null,
): z.infer<typeof checkedTargetSchema> {
  return {
    url,
    status,
    headers,
    policy: parseCspHeader(getHeader(headers, CSP_HEADER)),
    reportOnlyPolicy: parseCspHeader(getHeader(headers, CSP_REPORT_ONLY_HEADER)),
    error,
  };
}

function headersToObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });
  return output;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)?.[1];
}

function parseCspHeader(header: string | undefined): Record<string, string[]> | null {
  if (!header || header.trim().length === 0) return null;

  const directives: Record<string, string[]> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [name, ...values] = trimmed.split(/\s+/);
    const directiveName = name.toLowerCase();
    if (!directiveName) continue;

    if (!directives[directiveName]) {
      directives[directiveName] = values;
    } else {
      directives[directiveName].push(...values);
    }
  }

  return Object.keys(directives).length > 0 ? directives : null;
}

function evaluateCspHeaders(
  url: string,
  headers: Record<string, string>,
  options: { includeReportOnly: boolean; fetchError?: string | null },
): CspFinding[] {
  if (options.fetchError) {
    return [
      finding(url, {
        checkId: 'csp-fetch-error',
        title: 'Could not fetch CSP headers',
        severity: 'info',
        headerName: null,
        directive: null,
        value: options.fetchError,
        description: 'The target could not be fetched, so CSP headers were not evaluated.',
        remediation: 'Verify the URL, network route, and target availability before rerunning.',
      }),
    ];
  }

  const policy = parseCspHeader(getHeader(headers, CSP_HEADER));
  const reportOnlyPolicy = parseCspHeader(getHeader(headers, CSP_REPORT_ONLY_HEADER));

  if (!policy) {
    if (reportOnlyPolicy && options.includeReportOnly) {
      return [
        finding(url, {
          checkId: 'csp-report-only-not-enforced',
          title: 'CSP is report-only',
          severity: 'low',
          headerName: 'Content-Security-Policy-Report-Only',
          directive: null,
          value: getHeader(headers, CSP_REPORT_ONLY_HEADER) ?? null,
          description:
            'A report-only policy records violations but does not block script, object, frame, or base URL abuse.',
          remediation:
            'Promote the reviewed policy to Content-Security-Policy once reports are clean.',
        }),
        ...evaluatePolicy(url, reportOnlyPolicy, 'Content-Security-Policy-Report-Only'),
      ];
    }

    return [
      finding(url, {
        checkId: 'csp-missing',
        title: 'Missing enforced CSP header',
        severity: 'medium',
        headerName: 'Content-Security-Policy',
        directive: null,
        value: null,
        description: 'The response does not include an enforced Content-Security-Policy header.',
        remediation:
          "Add a restrictive CSP, starting with default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none' or trusted origins.",
      }),
    ];
  }

  return evaluatePolicy(url, policy, 'Content-Security-Policy');
}

function evaluatePolicy(
  url: string,
  policy: Record<string, string[]>,
  headerName: string,
): CspFinding[] {
  const findings: CspFinding[] = [];
  const defaultSrc = directiveValues(policy, 'default-src');
  const scriptSrc = directiveValues(policy, 'script-src') ?? defaultSrc;
  const objectSrc = directiveValues(policy, 'object-src');
  const baseUri = directiveValues(policy, 'base-uri');
  const frameAncestors = directiveValues(policy, 'frame-ancestors');

  if (!defaultSrc) {
    findings.push(
      finding(url, {
        checkId: 'csp-default-src-missing',
        title: 'Missing default-src directive',
        severity: 'medium',
        headerName,
        directive: 'default-src',
        value: null,
        description:
          'Without default-src, many fetch directives have no restrictive fallback policy.',
        remediation: "Add a restrictive fallback such as default-src 'self'.",
      }),
    );
  } else {
    findings.push(...riskySourceFindings(url, headerName, 'default-src', defaultSrc));
  }

  if (!scriptSrc) {
    findings.push(
      finding(url, {
        checkId: 'csp-script-src-missing',
        title: 'Missing script-src directive or fallback',
        severity: 'high',
        headerName,
        directive: 'script-src',
        value: null,
        description:
          'No script-src or default-src directive controls where executable JavaScript can load from.',
        remediation:
          'Add script-src with nonces or hashes and avoid unsafe-inline, unsafe-eval, wildcards, and plain HTTP sources.',
      }),
    );
  } else {
    findings.push(...riskySourceFindings(url, headerName, 'script-src', scriptSrc));
    findings.push(...scriptSpecificFindings(url, headerName, scriptSrc));
  }

  if (!objectSrc) {
    findings.push(
      finding(url, {
        checkId: 'csp-object-src-missing',
        title: 'Missing object-src directive',
        severity: 'low',
        headerName,
        directive: 'object-src',
        value: null,
        description:
          'object-src is not explicitly disabled, leaving legacy plugin content controlled only by fallback behavior.',
        remediation: "Add object-src 'none' unless plugin content is explicitly required.",
      }),
    );
  } else if (!hasOnlyNone(objectSrc)) {
    findings.push(...riskySourceFindings(url, headerName, 'object-src', objectSrc));
  }

  if (!baseUri) {
    findings.push(
      finding(url, {
        checkId: 'csp-base-uri-missing',
        title: 'Missing base-uri directive',
        severity: 'low',
        headerName,
        directive: 'base-uri',
        value: null,
        description: 'Missing base-uri allows injected base tags to alter relative URL resolution.',
        remediation: "Add base-uri 'self' or base-uri 'none'.",
      }),
    );
  } else {
    findings.push(...riskySourceFindings(url, headerName, 'base-uri', baseUri));
  }

  if (!frameAncestors) {
    findings.push(
      finding(url, {
        checkId: 'csp-frame-ancestors-missing',
        title: 'Missing frame-ancestors directive',
        severity: 'low',
        headerName,
        directive: 'frame-ancestors',
        value: null,
        description:
          'Missing frame-ancestors leaves clickjacking protection to other headers or browser defaults.',
        remediation: "Add frame-ancestors 'none', 'self', or trusted embedding origins.",
      }),
    );
  } else {
    findings.push(...riskySourceFindings(url, headerName, 'frame-ancestors', frameAncestors));
  }

  return findings;
}

function directiveValues(
  policy: Record<string, string[]>,
  directive: string,
): string[] | undefined {
  return policy[directive]?.map((value) => value.toLowerCase());
}

function hasOnlyNone(values: string[]): boolean {
  return values.length === 1 && values[0] === "'none'";
}

function riskySourceFindings(
  url: string,
  headerName: string,
  directive: string,
  values: string[],
): CspFinding[] {
  const findings: CspFinding[] = [];

  for (const value of values) {
    if (value === '*') {
      findings.push(
        riskySourceFinding(url, headerName, directive, value, 'high', 'wildcard source'),
      );
    } else if (value === 'http:' || value.startsWith('http://')) {
      findings.push(
        riskySourceFinding(url, headerName, directive, value, 'medium', 'plain HTTP source'),
      );
    } else if (
      value === 'data:' &&
      ['default-src', 'script-src', 'object-src'].includes(directive)
    ) {
      findings.push(riskySourceFinding(url, headerName, directive, value, 'medium', 'data URI'));
    }
  }

  return findings;
}

function scriptSpecificFindings(url: string, headerName: string, values: string[]): CspFinding[] {
  const checks: { token: string; severity: Severity; reason: string }[] = [
    { token: "'unsafe-inline'", severity: 'medium', reason: 'inline script execution' },
    { token: "'unsafe-eval'", severity: 'high', reason: 'string-to-code execution' },
    { token: 'blob:', severity: 'low', reason: 'blob script execution' },
  ];

  return checks
    .filter((check) => values.includes(check.token))
    .map((check) =>
      finding(url, {
        checkId: `csp-script-src-${check.token.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        title: `script-src allows ${check.reason}`,
        severity: check.severity,
        headerName,
        directive: 'script-src',
        value: check.token,
        description: `script-src includes ${check.token}, allowing ${check.reason}.`,
        remediation:
          'Use nonces, hashes, strict-dynamic, and trusted HTTPS origins instead of broad script execution allowances.',
      }),
    );
}

function riskySourceFinding(
  url: string,
  headerName: string,
  directive: string,
  value: string,
  severity: Severity,
  reason: string,
): CspFinding {
  return finding(url, {
    checkId: `csp-${directive}-${reason.replace(/\s+/g, '-')}`,
    title: `${directive} allows ${reason}`,
    severity,
    headerName,
    directive,
    value,
    description: `${directive} contains ${value}, which permits a risky ${reason}.`,
    remediation:
      'Replace broad source expressions with specific HTTPS origins, nonces, hashes, or a stricter fallback.',
  });
}

function finding(url: string, data: Omit<CspFinding, 'url'>): CspFinding {
  return { url, ...data };
}

function createAnalyticsResults(findings: CspFinding[]): AnalyticsResult[] {
  return findings.map((item) => ({
    scanner: 'csp-checks',
    finding_hash: generateFindingHash(item.checkId, item.url, item.directive, item.value),
    severity: item.severity,
    asset_key: item.url,
    url: item.url,
    check_id: item.checkId,
    title: item.title,
    directive: item.directive,
    value: item.value,
    header_name: item.headerName,
    remediation: item.remediation,
  }));
}

componentRegistry.register(definition);

export {
  createAnalyticsResults,
  evaluateCspHeaders,
  evaluatePolicy,
  parseCspHeader,
  type CspFinding,
  type InputShape,
  type OutputShape,
};
