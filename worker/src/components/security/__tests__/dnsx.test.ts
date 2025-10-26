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
    expect(component!.category).toBe('discovery');
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
    });

    const payload = {
      results: [
        {
          host: 'example.com',
          status_code: 'NOERROR',
          ttl: 30,
          resolver: ['8.8.8.8:53'],
          a: ['23.215.0.138', '23.215.0.136'],
          timestamp: '2025-10-18T17:35:42Z',
        },
      ],
      rawOutput:
        '{"host":"example.com","ttl":30,"resolver":["8.8.8.8:53"],"a":["23.215.0.138","23.215.0.136"],"status_code":"NOERROR"}',
      domainCount: 1,
      recordCount: 2,
      recordTypes: ['A'],
      resolvers: [],
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.domainCount).toBe(1);
    expect(result.recordCount).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].host).toBe('example.com');
    expect(result.results[0].answers.a).toEqual(['23.215.0.138', '23.215.0.136']);
    expect(result.recordTypes).toEqual(['A']);
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
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      'example.com [23.215.0.138]\nexample.com [23.215.0.136]',
    );

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.results).toHaveLength(2);
    expect(result.errors ?? []).not.toHaveLength(0);
    expect((result.errors ?? [])[0]).toContain('dnsx');
    expect(result.recordCount).toBe(2);
  });

  it('should use docker runner config for dnsx image', () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/dnsx:latest');
      expect(component.runner.entrypoint).toBe('sh');
    }
  });
});
