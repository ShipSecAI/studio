import { describe, expect, test, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import { parseKatanaOutput } from '../katana';
import type { KatanaOutput, InputShape, OutputShape } from '../katana';

const runKatanaTests = process.env.ENABLE_KATANA_COMPONENT_TESTS === 'true';
const describeKatana = runKatanaTests ? describe : describe.skip;

describeKatana('katana component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseKatanaOutput helper', () => {
    test('parses valid katana JSON lines', () => {
      const raw = [
        '{"request":{"method":"GET","endpoint":"https://example.com/api/users","source":"https://example.com","tag":"a","attribute":"href"},"timestamp":"2024-01-01T00:00:00Z"}',
        '{"request":{"method":"POST","endpoint":"https://example.com/login","source":"https://example.com/app.js","tag":"script","attribute":"src"},"timestamp":"2024-01-02T00:00:00Z"}',
      ].join('\n');

      const { endpoints, urls } = parseKatanaOutput(raw);

      expect(endpoints).toHaveLength(2);
      expect(urls).toHaveLength(2);

      expect(endpoints[0]).toMatchObject({
        url: 'https://example.com/api/users',
        method: 'GET',
        source: 'https://example.com',
        tag: 'a',
        attribute: 'href',
      });

      expect(endpoints[1]).toMatchObject({
        url: 'https://example.com/login',
        method: 'POST',
        source: 'https://example.com/app.js',
        tag: 'script',
      });
    });

    test('parses plain URL output', () => {
      const raw = [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/api/v1/data',
      ].join('\n');

      const { endpoints, urls } = parseKatanaOutput(raw);

      expect(endpoints).toHaveLength(3);
      expect(urls).toHaveLength(3);
      expect(urls).toContain('https://example.com/page1');
      expect(urls).toContain('https://example.com/api/v1/data');
    });

    test('handles mixed JSON and plain URL output', () => {
      const raw = [
        '{"request":{"endpoint":"https://example.com/api"}}',
        'https://example.com/static/main.js',
        'invalid-line',
        '{"endpoint":"https://example.com/form"}',
      ].join('\n');

      const { endpoints, urls } = parseKatanaOutput(raw);

      expect(endpoints).toHaveLength(3);
      expect(urls).toHaveLength(3);
    });

    test('deduplicates URLs', () => {
      const raw = [
        'https://example.com/page',
        'https://example.com/page',
        '{"request":{"endpoint":"https://example.com/page"}}',
      ].join('\n');

      const { urls } = parseKatanaOutput(raw);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/page');
    });

    test('returns empty arrays for blank input', () => {
      expect(parseKatanaOutput('')).toEqual({ endpoints: [], urls: [] });
      expect(parseKatanaOutput('   \n  ')).toEqual({ endpoints: [], urls: [] });
    });
  });

  test('registers the katana component', () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Katana Web Crawler');
    expect(component!.category).toBe('security');
  });

  test('normalises docker runner JSON output', async () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const params = component.inputs.parse({
      targets: ['https://example.com'],
    });

    const payload: KatanaOutput = {
      endpoints: [
        {
          url: 'https://example.com/api',
          method: 'GET',
          endpoint: 'https://example.com/api',
          source: 'https://example.com',
          tag: 'a',
          attribute: 'href',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      urls: ['https://example.com/api'],
      rawOutput: '{"request":{"endpoint":"https://example.com/api"}}',
      targetCount: 1,
      endpointCount: 1,
      options: {
        depth: 3,
        jsCrawl: false,
        headless: false,
        concurrency: null,
        parallelism: null,
        rateLimit: null,
        timeout: null,
        crawlDuration: null,
        knownFiles: null,
        extensionMatch: null,
        extensionFilter: null,
        scope: null,
        ignoreQueryParams: false,
        formExtraction: false,
        xhrExtraction: false,
      },
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = (await component.execute(
      { inputs: params, params: {} },
      context,
    )) as KatanaOutput;

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpointCount).toBe(1);
    expect(result.urls).toContain('https://example.com/api');
  });

  test('falls back to parsing raw string output when provided', async () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const params = component.inputs.parse({
      targets: ['https://example.com'],
    });

    const raw = [
      '{"request":{"method":"GET","endpoint":"https://example.com/page1"}}',
      '{"request":{"method":"POST","endpoint":"https://example.com/api/submit"}}',
    ].join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(raw);

    const result = await component.execute({ inputs: params, params: {} }, context);

    expect(result.endpoints).toHaveLength(2);
    expect(result.urls).toHaveLength(2);
    expect(result.rawOutput).toContain('https://example.com/api/submit');
  });

  test('skips execution when no targets are provided', async () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const params = component.inputs.parse({
      targets: [],
    });

    const spy = vi.spyOn(sdk, 'runComponentWithRunner');
    const result = await component.execute({ inputs: params, params: {} }, context);

    expect(spy).not.toHaveBeenCalled();
    expect(result.endpoints).toHaveLength(0);
    expect(result.urls).toHaveLength(0);
    expect(result.targetCount).toBe(0);
    expect(result.endpointCount).toBe(0);
    expect(result.rawOutput).toBe('');
  });

  test('throws when katana exits with a non-zero status', async () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const params = component.inputs.parse({
      targets: ['https://example.com'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
      results: [],
      raw: '',
      stderr: 'connection refused',
      exitCode: 1,
    });

    await expect(component.execute({ inputs: params, params: {} }, context)).rejects.toThrow(
      /katana exited with code 1/,
    );
  });

  test('applies JS crawl and headless options correctly', async () => {
    const component = componentRegistry.get<InputShape, OutputShape>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const params = component.inputs.parse({
      targets: ['https://example.com'],
    });

    const componentParams = {
      jsCrawl: true,
      headless: true,
      depth: 5,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    const result = await component.execute({ inputs: params, params: componentParams }, context);

    expect(result.options.jsCrawl).toBe(true);
    expect(result.options.headless).toBe(true);
    expect(result.options.depth).toBe(5);
  });
});
