import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { SubfinderInput, SubfinderOutput } from '../subfinder';

describe('subfinder component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Subfinder');
    expect(component!.category).toBe('discovery');
  });

  it('should normalise raw output returned as plain text', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('api.example.com\napp.example.com');

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result.subdomains).toEqual(['api.example.com', 'app.example.com']);
    expect(result.rawOutput).toBe('api.example.com\napp.example.com');
    expect(result.domainCount).toBe(1);
    expect(result.subdomainCount).toBe(2);
  });

  it('should return structured output when docker emits JSON', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
    });

    const payload = {
      subdomains: ['api.example.com'],
      rawOutput: 'api.example.com',
      domainCount: 1,
      subdomainCount: 1,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = component.outputSchema.parse(await component.execute(params, context));

    expect(result).toEqual(component.outputSchema.parse(payload as SubfinderOutput));
  });

  it('should accept a single domain string and normalise to array', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({ domains: 'example.com' }) as { domains: string[] };
    expect(params.domains).toEqual(['example.com']);
  });

  it('should accept legacy "domain" key from older workflows', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const params = component.inputSchema.parse({ domain: 'legacy.example.com' }) as { domains: string[] };
    expect(params.domains).toEqual(['legacy.example.com']);
  });

  it('should inject provider config secret into docker environment when configured', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const secretId = '123e4567-e89b-42d3-a456-426614174000';
    const secretValue = `providers:
  - name: shodan
    api_key: abc123`;

    const secrets: sdk.ISecretsService = {
      async get(key) {
        expect(key).toBe(secretId);
        return { value: secretValue, version: 1 };
      },
      async list() {
        return [];
      },
    };

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-secret-test',
      secrets,
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
      providerConfigSecretId: secretId,
    });

    const runnerSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue({
        subdomains: [],
        rawOutput: '',
        domainCount: 1,
        subdomainCount: 0,
      });

    await component.execute(params, context);

    expect(runnerSpy).toHaveBeenCalled();
    const [runnerConfig] = runnerSpy.mock.calls[0];
    expect(runnerConfig).toBeDefined();
    if (runnerConfig && runnerConfig.kind === 'docker') {
      expect(runnerConfig.env?.SUBFINDER_PROVIDER_CONFIG_B64).toBe(
        Buffer.from(secretValue, 'utf8').toString('base64'),
      );
    }
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/subfinder:latest');
    }
  });
});
