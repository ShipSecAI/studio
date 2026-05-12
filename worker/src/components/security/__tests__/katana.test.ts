import { afterEach, beforeAll, describe, expect, test, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import { IsolatedContainerVolume } from '../../../utils/isolated-volume';
import { buildKatanaArgs, parseKatanaOutput } from '../katana';
import type { KatanaInput, KatanaOutput } from '../katana';

describe('Katana component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockIsolatedVolume() {
    vi.spyOn(IsolatedContainerVolume.prototype, 'initialize').mockResolvedValue(
      'shipsec-test-volume',
    );
    vi.spyOn(IsolatedContainerVolume.prototype, 'cleanup').mockResolvedValue(undefined);
    vi.spyOn(IsolatedContainerVolume.prototype, 'getVolumeConfig').mockReturnValue({
      source: 'shipsec-test-volume',
      target: '/inputs',
      readOnly: true,
    });
  }

  test('registers the Katana component', () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');

    expect(component).toBeDefined();
    expect(component!.label).toBe('Katana Web Crawler');
    expect(component!.category).toBe('security');
    expect(component!.ui?.slug).toBe('katana');
  });

  test('builds Katana CLI arguments from parameters', () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const params = component.parameters!.parse({
      depth: 4,
      strategy: 'breadth-first',
      jsCrawl: true,
      formExtraction: true,
      xhrExtraction: true,
      headers: ['Authorization: Bearer test'],
      matchRegex: ['admin'],
      filterRegex: ['logout'],
      extensionMatch: ['js'],
      customFlags: '-headless -automatic-form-fill',
    });

    const args = buildKatanaArgs(params as Parameters<typeof buildKatanaArgs>[0]);

    expect(args).toContain('-list');
    expect(args).toContain('/inputs/targets.txt');
    expect(args).toContain('-jsonl');
    expect(args).toContain('-depth');
    expect(args).toContain('4');
    expect(args).toContain('-strategy');
    expect(args).toContain('breadth-first');
    expect(args).toContain('-js-crawl');
    expect(args).toContain('-form-extraction');
    expect(args).toContain('-xhr-extraction');
    expect(args).toContain('-headers');
    expect(args).toContain('Authorization: Bearer test');
    expect(args).toContain('-match-regex');
    expect(args).toContain('admin');
    expect(args).toContain('-filter-regex');
    expect(args).toContain('logout');
    expect(args).toContain('-extension-match');
    expect(args).toContain('js');
    expect(args).toContain('-headless');
    expect(args).toContain('-automatic-form-fill');
  });

  test('parses Katana JSONL and plain URL output', () => {
    const raw = [
      JSON.stringify({
        url: 'https://example.com/login',
        source: 'https://example.com/',
        tag: 'a',
        attribute: 'href',
        method: 'GET',
        fqdn: 'example.com',
        path: '/login',
        status_code: 200,
        content_length: '1234',
        timestamp: '2026-05-12T09:00:00Z',
      }),
      JSON.stringify({
        endpoint: 'https://example.com/api/users',
        source: 'https://example.com/app.js',
        tag: 'script',
        attribute: 'src',
        method: 'POST',
        statusCode: '201',
      }),
      'https://static.example.com/app.js',
      'not a url',
    ].join('\n');

    const endpoints = parseKatanaOutput(raw);

    expect(endpoints).toHaveLength(3);
    expect(endpoints[0]).toMatchObject({
      url: 'https://example.com/login',
      source: 'https://example.com/',
      tag: 'a',
      attribute: 'href',
      method: 'GET',
      host: 'example.com',
      path: '/login',
      statusCode: 200,
      contentLength: 1234,
    });
    expect(endpoints[1]).toMatchObject({
      url: 'https://example.com/api/users',
      source: 'https://example.com/app.js',
      method: 'POST',
      statusCode: 201,
    });
    expect(endpoints[2]).toMatchObject({
      url: 'https://static.example.com/app.js',
      host: 'static.example.com',
      path: '/app.js',
    });
  });

  test('runs via docker runner and normalises raw output', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'katana-test-run',
      componentRef: 'katana-test',
    });

    const inputs = component.inputs.parse({
      targets: ['https://example.com'],
    });
    const params = component.parameters!.parse({});

    mockIsolatedVolume();
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      [
        JSON.stringify({
          url: 'https://example.com/login',
          source: 'https://example.com/',
          tag: 'a',
          attribute: 'href',
        }),
        JSON.stringify({
          url: 'https://example.com/login',
          source: 'https://example.com/',
          tag: 'a',
          attribute: 'href',
        }),
        'https://example.com/app.js',
      ].join('\n'),
    );

    const result = await component.execute({ inputs, params }, context);

    expect(result.endpoints).toHaveLength(2);
    expect(result.urls).toEqual(['https://example.com/login', 'https://example.com/app.js']);
    expect(result.targetCount).toBe(1);
    expect(result.endpointCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.options.depth).toBe(3);
  });

  test('skips execution when no targets are provided', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'katana-empty-run',
      componentRef: 'katana-test',
    });

    const inputs = component.inputs.parse({
      targets: [],
    });
    const params = component.parameters!.parse({});

    const spy = vi.spyOn(sdk, 'runComponentWithRunner');
    const result = await component.execute({ inputs, params }, context);

    expect(spy).not.toHaveBeenCalled();
    expect(result.endpoints).toHaveLength(0);
    expect(result.urls).toHaveLength(0);
    expect(result.targetCount).toBe(0);
    expect(result.endpointCount).toBe(0);
  });

  test('throws when Katana exits with a non-zero status', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'katana-error-run',
      componentRef: 'katana-test',
    });

    const inputs = component.inputs.parse({
      targets: ['https://example.com'],
    });
    const params = component.parameters!.parse({});

    mockIsolatedVolume();
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
      stdout: '',
      stderr: 'crawl failed',
      exitCode: 2,
    });

    await expect(component.execute({ inputs, params }, context)).rejects.toThrow(
      /Katana exited with code 2/,
    );
  });
});
