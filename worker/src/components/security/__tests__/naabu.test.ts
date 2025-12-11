import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { NaabuInput, NaabuOutput } from '../naabu';

describe('naabu component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered with correct metadata', () => {
    const component = componentRegistry.get<NaabuInput, NaabuOutput>('shipsec.naabu.scan');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Naabu Port Scan');
    expect(component!.category).toBe('security');
  });

  it('should provide sensible defaults', () => {
    const component = componentRegistry.get<NaabuInput, NaabuOutput>('shipsec.naabu.scan');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({
      targets: ['scanme.sh'],
    });

    expect(params.retries).toBe(1);
    expect(params.enablePing).toBe(false);
  });

  it('should parse JSONL output into findings', async () => {
    const component = componentRegistry.get<NaabuInput, NaabuOutput>('shipsec.naabu.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'naabu-test',
    });

    const params = component.inputSchema.parse({
      targets: ['scanme.sh'],
      ports: '80,443',
      enablePing: true,
    });

    const rawOutput = [
      JSON.stringify({ host: 'scanme.sh', ip: '45.33.32.156', port: 80, proto: 'tcp' }),
      JSON.stringify({ host: 'scanme.sh', ip: '45.33.32.156', port: 443, proto: 'tcp' }),
    ].join('\n');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(rawOutput);

    const result = await component.execute(params, context);

    expect(result.findings).toEqual([
      { host: 'scanme.sh', ip: '45.33.32.156', port: 80, protocol: 'tcp' },
      { host: 'scanme.sh', ip: '45.33.32.156', port: 443, protocol: 'tcp' },
    ]);
    expect(result.openPortCount).toBe(2);
    expect(result.rawOutput).toBe(rawOutput);
    expect(result.options.ports).toBe('80,443');
    expect(result.options.enablePing).toBe(true);
  });

  it('should handle plain host:port output', async () => {
    const component = componentRegistry.get<NaabuInput, NaabuOutput>('shipsec.naabu.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'naabu-test',
    });

    const params = component.inputSchema.parse({
      targets: ['scanme.sh'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('scanme.sh:22\n');

    const result = await component.execute(params, context);

    expect(result.findings).toEqual([
      { host: 'scanme.sh', ip: null, port: 22, protocol: 'tcp' },
    ]);
    expect(result.openPortCount).toBe(1);
  });

  it('should configure docker runner for naabu image', () => {
    const component = componentRegistry.get<NaabuInput, NaabuOutput>('shipsec.naabu.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/naabu:v2.3.7');
      expect(component.runner.entrypoint).toBe('sh');
      expect(component.runner.command).toBeInstanceOf(Array);
    }
  });
});
