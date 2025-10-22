import { describe, expect, test, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import { parseHttpxOutput } from '../httpx';

const runHttpxTests = process.env.ENABLE_HTTPX_COMPONENT_TESTS === 'true';
const describeHttpx = runHttpxTests ? describe : describe.skip;

describeHttpx('httpx component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseHttpxOutput helper', () => {
    test('parses valid httpx JSON lines', () => {
      const raw = [
        '{"url":"https://example.com","host":"example.com","status-code":200,"title":"Example Domain","webserver":"ECS","content-length":648,"response-time":0.123,"scheme":"https","final-url":"https://www.example.com","tech":["HTTP","CDN"],"chain-status":[301,200],"timestamp":"2023-01-01T00:00:00Z"}',
        '{"host":"test.example","input":"test.example","status-code":403,"port":8080,"scheme":"http","location":"https://test.example/login","tech":["nginx"],"timestamp":"2023-01-02T00:00:00Z"}',
      ].join('\n');

      const results = parseHttpxOutput(raw);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        url: 'https://example.com',
        host: 'example.com',
        statusCode: 200,
        title: 'Example Domain',
        webserver: 'ECS',
        scheme: 'https',
        finalUrl: 'https://www.example.com',
        technologies: ['HTTP', 'CDN'],
        chainStatus: [301, 200],
      });
      expect(results[0].contentLength).toBe(648);
      expect(results[0].responseTime).toBeCloseTo(0.123);

      expect(results[1]).toMatchObject({
        url: 'test.example',
        host: 'test.example',
        statusCode: 403,
        port: 8080,
        scheme: 'http',
        location: 'https://test.example/login',
        technologies: ['nginx'],
      });
      expect(results[1].finalUrl).toBeNull();
    });

    test('ignores invalid lines and returns empty array for blanks', () => {
      const raw = '\nnot-json\n {"url":"https://valid.test","status-code":"abc"}';
      const results = parseHttpxOutput(raw);

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://valid.test');
      expect(results[0].statusCode).toBeNull();

      expect(parseHttpxOutput('')).toHaveLength(0);
    });
  });

  test('registers the httpx component', () => {
    const component = componentRegistry.get('shipsec.httpx.scan');
    expect(component).toBeDefined();
    expect(component?.label).toBe('httpx Web Probe');
    expect(component?.category).toBe('discovery');
  });

  test('normalises docker runner JSON output', async () => {
    const component = componentRegistry.get('shipsec.httpx.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'httpx-test',
    });

    const params = component.inputSchema.parse({
      targets: ['https://example.com'],
    });

    const payload = {
      results: [
        {
          url: 'https://example.com',
          host: 'example.com',
          'status-code': 200,
          title: 'Example Domain',
          tech: ['HTTP', 'CDN'],
        },
      ],
      raw:
        '{"url":"https://example.com","host":"example.com","status-code":200,"title":"Example Domain","tech":["HTTP","CDN"]}',
      stderr: '',
      exitCode: 0,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = (await component.execute(params, context)) as any;

    expect(result.results).toHaveLength(1);
    expect(result.resultCount).toBe(1);
    expect(result.rawOutput).toContain('https://example.com');
    expect(result.options.followRedirects).toBe(false);
  });

  test('falls back to parsing raw string output when provided', async () => {
    const component = componentRegistry.get('shipsec.httpx.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'httpx-test',
    });

    const params = component.inputSchema.parse({
      targets: ['https://example.com'],
      followRedirects: true,
    });

    const raw = [
      '{"url":"https://example.com","status-code":200,"title":"Example"}',
      '{"input":"https://other.example","status-code":301}',
    ].join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(raw);

    const result = (await component.execute(params, context)) as any;

    expect(result.results).toHaveLength(2);
    expect(result.options.followRedirects).toBe(true);
    expect(result.rawOutput).toContain('https://other.example');
  });

  test('throws when httpx exits with a non-zero status', async () => {
    const component = componentRegistry.get('shipsec.httpx.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'httpx-test',
    });

    const params = component.inputSchema.parse({
      targets: ['https://example.com'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
      results: [],
      raw: '',
      stderr: 'network timeout',
      exitCode: 2,
    });

    await expect(component.execute(params, context)).rejects.toThrow(/httpx exited with code 2/);
  });
});
