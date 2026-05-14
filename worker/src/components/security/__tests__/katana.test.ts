import { describe, it, expect, beforeAll, afterEach, vi, mock } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import type { KatanaInput, KatanaOutput } from '../katana';

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'mock-volume';
    }
    getVolumeConfig(containerPath = '/inputs', readOnly = true) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }
    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@shipsec/component-sdk').componentRegistry;

describe('katana component', () => {
  beforeAll(async () => {
    ({ componentRegistry } = await import('../../index'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Katana Web Crawler');
    expect(component!.category).toBe('security');
  });

  it('should normalise raw output returned as plain text', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const executePayload = {
      inputs: {
        urls: ['https://example.com'],
      },
      params: {},
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      'https://example.com/login\nhttps://example.com/dashboard',
    );

    const result = component.outputs.parse(await component.execute(executePayload, context));

    expect(result.crawledUrls).toEqual([
      'https://example.com/login',
      'https://example.com/dashboard',
    ]);
    expect(result.rawOutput).toBe('https://example.com/login\nhttps://example.com/dashboard');
    expect(result.targetCount).toBe(1);
    expect(result.urlCount).toBe(2);
  });

  it('should accept legacy "urls" string array and normalise', () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const inputs = component.inputs.parse({ urls: 'https://example.com' });
    expect(inputs.urls).toEqual(['https://example.com']);
  });

  it('should pass JS crawl and Headless flags when configured', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'katana-test',
    });

    const executePayload = {
      inputs: {
        urls: ['https://example.com'],
      },
      params: {
        jsCrawl: true,
        headless: true,
        depth: 2,
      },
    };

    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(executePayload, context);

    expect(runnerSpy).toHaveBeenCalled();
    const [runnerConfig] = runnerSpy.mock.calls[0];
    expect(runnerConfig).toBeDefined();
    if (runnerConfig && runnerConfig.kind === 'docker') {
      const command = runnerConfig.command ?? [];
      expect(command).toContain('-jc');
      expect(command).toContain('-hl');
      expect(command).toContain('-d');
      const dIndex = command.indexOf('-d');
      expect(command[dIndex + 1]).toBe('2');
    }
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('ghcr.io/shipsecai/katana:latest');
    }
  });
});
