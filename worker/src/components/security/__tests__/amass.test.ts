import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { AmassInput, AmassOutput } from '../amass';

// TODO: Fix flaky Docker timeout issues
describe.skip('amass component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered with correct metadata', () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Amass Enumeration');
    expect(component!.category).toBe('security');
  });

  it('should provide default options when omitted', () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    if (!component) throw new Error('Component not registered');

    const paramValues = {};

    const parsedParams = component.parameters!.parse(paramValues);

    expect(parsedParams.passive).toBe(true);
    expect(parsedParams.active).toBe(false);
    expect(parsedParams.bruteForce).toBe(false);
    expect(parsedParams.includeIps).toBe(false);
    expect(parsedParams.enableAlterations).toBe(false);
    expect(parsedParams.recursive).toBe(false);
    expect(parsedParams.verbose).toBe(false);
    expect(parsedParams.demoMode).toBe(false);
    expect(parsedParams.timeoutMinutes).toBe(15);
    expect(parsedParams.resolvers).toBe('1.1.1.1,8.8.8.8,9.9.9.9,8.8.4.4,1.0.0.1');
    expect(parsedParams.dataSources).toBe('crtsh,hackertarget');
    expect(parsedParams.minForRecursive).toBeUndefined();
    expect(parsedParams.maxDepth).toBeUndefined();
    expect(parsedParams.dnsQueryRate).toBeUndefined();
    expect(parsedParams.customFlags).toBeUndefined();
  });

  it('should parse raw text output from docker container', async () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'amass-test',
    });

    const executePayload = {
      inputs: {
        domains: ['example.com'],
      },
      params: {
        active: true,
      },
    };

    // Mock docker returning raw subdomain output (one per line)
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('api.example.com\nwww.example.com');

    const result = await component.execute(executePayload, context);

    expect(result.subdomains).toContain('api.example.com');
    expect(result.subdomains).toContain('www.example.com');
    expect(result.subdomainCount).toBe(2);
    expect(result.domainCount).toBe(1);
  });

  it('should handle structured object output from docker', async () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'amass-test',
    });

    const executePayload = {
      inputs: {
        domains: ['example.com', 'example.org'],
      },
      params: {
        bruteForce: true,
        includeIps: true,
        timeoutMinutes: 2,
      },
    };

    // Mock docker returning raw output with IP addresses
    const rawOutput = 'login.example.com 93.184.216.34\ndev.example.org';
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(rawOutput);

    const result = await component.execute(executePayload, context);

    expect(result.subdomains).toContain('login.example.com');
    expect(result.subdomains).toContain('dev.example.org');
    expect(result.subdomainCount).toBe(2);
    expect(result.domainCount).toBe(2);
    expect(result.rawOutput).toBe(rawOutput);
  });

  it('should configure docker runner for owaspamass/amass image', () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('owaspamass/amass:v5.0.1');
      expect(component.runner.entrypoint).toBe('sh');
      expect(component.runner.command).toBeInstanceOf(Array);
    }
  });
});
