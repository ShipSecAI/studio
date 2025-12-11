import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { DnsxInput, DnsxOutput } from '../dnsx';

describe('dnsx component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered with metadata', () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    expect(component).toBeDefined();
    expect(component!.label).toBe('DNSX Resolver');
    expect(component!.category).toBe('security');
    expect(component!.metadata?.slug).toBe('dnsx');
  });

  it('should normalise structured JSON output from dnsx', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'dnsx-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
      recordTypes: ['A'],
      resolvers: [],
      outputMode: 'json',
    });

    const ndjson = [
      {
        host: 'example.com',
        status_code: 'NOERROR',
        ttl: 30,
        resolver: ['8.8.8.8:53'],
        a: ['23.215.0.138'],
        timestamp: '2025-10-18T17:35:42Z',
      },
      {
        host: 'example.com',
        status_code: 'NOERROR',
        ttl: 30,
        resolver: ['8.8.8.8:53'],
        a: ['23.215.0.136'],
        timestamp: '2025-10-18T17:35:43Z',
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(ndjson);

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.domainCount).toBe(1);
    expect(result.recordCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].host).toBe('example.com');
    const aggregatedAnswers = result.results.flatMap((entry) => entry.answers.a ?? []);
    expect(aggregatedAnswers).toEqual(['23.215.0.138', '23.215.0.136']);
    expect(result.recordTypes).toEqual(['A']);
    expect(result.resolvedHosts).toEqual(['example.com']);
  });

  it('should pass advanced options and custom flags into the runner', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'dnsx-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
      statusCodeFilter: 'noerror,servfail',
      proxy: 'socks5://127.0.0.1:9000',
      customFlags: "--rcode refused --proxy 'socks5://127.0.0.1:9000'",
    });

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(params, context);

    expect(spy).toHaveBeenCalled();
    const runnerConfig = spy.mock.calls[0][0];
    expect(runnerConfig).toBeDefined();
    if (runnerConfig && typeof runnerConfig === 'object' && 'command' in runnerConfig) {
      const command = (runnerConfig as any).command as string[];
      expect(command).toEqual(expect.arrayContaining(['-rcode', 'noerror,servfail']));
      expect(command).toEqual(expect.arrayContaining(['-proxy', 'socks5://127.0.0.1:9000']));
      expect(command).toEqual(expect.arrayContaining(['--rcode', 'refused', '--proxy', 'socks5://127.0.0.1:9000']));
    }
  });

  it('should gracefully fallback when dnsx returns non-JSON output', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'dnsx-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
      outputMode: 'silent',
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      'example.com [23.215.0.138]\nexample.com [23.215.0.136]',
    );

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.results).toHaveLength(2);
    expect(result.errors).toBeUndefined();
    expect(result.recordCount).toBe(2);
    expect(result.resolvedHosts).toEqual(['example.com']);
  });

  it('should skip execution when no domains are provided', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'dnsx-test',
    });

    const params = component.inputSchema.parse({
      domains: [],
      recordTypes: ['A'],
      resolvers: [],
    });

    const spy = vi.spyOn(sdk, 'runComponentWithRunner');
    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(spy).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(result.domainCount).toBe(0);
    expect(result.recordCount).toBe(0);
    expect(result.errors).toEqual([
      'No domains were provided to dnsx; upstream component produced an empty list.',
    ]);
  });

  it('should use docker runner config for dnsx image', () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/dnsx:v1.2.3');
      expect(component.runner.entrypoint).toBe('sh');
    }
  });
});
