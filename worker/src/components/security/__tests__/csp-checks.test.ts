import { afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import { evaluateCspHeaders, parseCspHeader } from '../csp-checks';

describe('CSP Checks component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('registers the CSP Checks component', () => {
    const component = componentRegistry.get('shipsec.csp.check');

    expect(component).toBeDefined();
    expect(component!.label).toBe('CSP Checks');
    expect(component!.category).toBe('security');
    expect(component!.ui?.slug).toBe('csp-checks');
  });

  test('parses CSP directives case-insensitively', () => {
    const policy = parseCspHeader(
      "default-src 'self'; SCRIPT-SRC 'self' 'unsafe-eval' https://cdn.example; object-src 'none'",
    );

    expect(policy).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-eval'", 'https://cdn.example'],
      'object-src': ["'none'"],
    });
  });

  test('flags missing enforced CSP headers', () => {
    const findings = evaluateCspHeaders('https://example.com', {}, { includeReportOnly: true });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkId: 'csp-missing',
      severity: 'medium',
      headerName: 'Content-Security-Policy',
    });
  });

  test('flags risky CSP directives', () => {
    const findings = evaluateCspHeaders(
      'https://example.com',
      {
        'content-security-policy':
          "default-src *; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://cdn.example; object-src data:",
      },
      { includeReportOnly: true },
    );

    expect(findings.map((finding) => finding.checkId)).toEqual(
      expect.arrayContaining([
        'csp-default-src-wildcard-source',
        'csp-script-src-plain-HTTP-source',
        'csp-script-src-unsafe-inline',
        'csp-script-src-unsafe-eval',
        'csp-base-uri-missing',
        'csp-frame-ancestors-missing',
      ]),
    );
    expect(findings.some((finding) => finding.severity === 'high')).toBe(true);
  });

  test('analyzes upstream HTTP headers without fetching', async () => {
    const component = componentRegistry.get('shipsec.csp.check');
    if (!component) throw new Error('Component not registered');

    const fetchSpy = vi.fn();
    const context = createMockContext(fetchSpy);

    const inputs = component.inputs.parse({
      url: 'https://example.com',
      headers: {
        'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'self'",
      },
    });
    const params = component.parameters!.parse({});

    const result = (await component.execute({ inputs, params }, context)) as any;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.targetCount).toBe(1);
    expect(result.findings.map((finding: any) => finding.checkId)).toContain(
      'csp-frame-ancestors-missing',
    );
    expect(result.results).toHaveLength(result.findings.length);
  });

  test('fetches target URLs and evaluates response headers', async () => {
    const component = componentRegistry.get('shipsec.csp.check');
    if (!component) throw new Error('Component not registered');

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('', {
        status: 200,
        headers: {
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      }),
    );
    const context = createMockContext(fetchSpy);

    const inputs = component.inputs.parse({
      targets: ['https://example.com', 'https://example.com'],
    });
    const params = component.parameters!.parse({ method: 'HEAD', timeoutMs: 2000 });

    const result = (await component.execute({ inputs, params }, context)) as any;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(result.targetCount).toBe(1);
    expect(result.findingCount).toBe(0);
  });
});

function createMockContext(fetchSpy: any): ExecutionContext {
  return {
    runId: 'csp-test-run',
    componentRef: 'csp-test',
    metadata: { runId: 'csp-test-run', componentRef: 'csp-test' },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    emitProgress: vi.fn(),
    http: {
      fetch: fetchSpy,
      toCurl: vi.fn(() => ''),
    },
  } as unknown as ExecutionContext;
}
