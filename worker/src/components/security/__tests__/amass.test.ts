import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { AmassInput, AmassOutput } from '../amass';

describe('amass component', () => {
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

    expect(parsedParams.active).toBe(false);
    expect(parsedParams.bruteForce).toBe(false);
    expect(parsedParams.includeIps).toBe(false);
    expect(parsedParams.enableAlterations).toBe(false);
    expect(parsedParams.recursive).toBe(true);
    expect(parsedParams.verbose).toBe(false);
    expect(parsedParams.demoMode).toBe(false);
    expect(parsedParams.timeoutMinutes).toBeUndefined();
    expect(parsedParams.minForRecursive).toBeUndefined();
    expect(parsedParams.maxDepth).toBeUndefined();
    expect(parsedParams.dnsQueryRate).toBeUndefined();
    expect(parsedParams.customFlags).toBeUndefined();
  });

  it('should parse raw JSON response returned as string', async () => {
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

    const payload = JSON.stringify({
      subdomains: ['api.example.com'],
      rawOutput: 'api.example.com',
      domainCount: 1,
      subdomainCount: 1,
      options: {
        active: true,
        bruteForce: false,
        includeIps: false,
        enableAlterations: false,
        recursive: true,
        verbose: false,
        demoMode: false,
        timeoutMinutes: null,
        minForRecursive: null,
        maxDepth: null,
        dnsQueryRate: null,
        customFlags: null,
      },
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = await component.execute(executePayload, context);

    expect(result).toEqual(component.outputs.parse(JSON.parse(payload)));
  });

  it('should propagate structured output when docker returns JSON', async () => {
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

    const payload = component.outputs.parse({
      subdomains: ['login.example.com', 'dev.example.org'],
      rawOutput: 'login.example.com\nlogin.example.com 93.184.216.34\ndev.example.org',
      domainCount: 2,
      subdomainCount: 2,
      options: {
        active: false,
        bruteForce: true,
        includeIps: true,
        enableAlterations: false,
        recursive: true,
        verbose: false,
        demoMode: false,
        timeoutMinutes: 2,
        minForRecursive: null,
        maxDepth: null,
        dnsQueryRate: null,
        customFlags: null,
      },
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = await component.execute(executePayload, context);
    expect(result).toEqual(payload);
  });

  it('should configure docker runner for owaspamass/amass image', () => {
    const component = componentRegistry.get<AmassInput, AmassOutput>('shipsec.amass.enum');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('owaspamass/amass:v4.2.0');
      expect(component.runner.entrypoint).toBe('sh');
      expect(component.runner.command).toBeInstanceOf(Array);
    }
  });
});
