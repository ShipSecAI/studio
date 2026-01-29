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
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    expect(component).toBeDefined();
    expect(component!.label).toBe('Subfinder');
    expect(component!.category).toBe('security');
  });

  it('should normalise raw output returned as plain text', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const executePayload = {
      inputs: {
        domains: ['example.com'],
      },
      params: {},
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('api.example.com\napp.example.com');

    const result = component.outputs.parse(await component.execute(executePayload, context));

    expect(result.subdomains).toEqual(['api.example.com', 'app.example.com']);
    expect(result.rawOutput).toBe('api.example.com\napp.example.com');
    expect(result.domainCount).toBe(1);
    expect(result.subdomainCount).toBe(2);
  });

  it('should return structured output when docker emits JSON', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const executePayload = {
      inputs: {
        domains: ['example.com'],
      },
      params: {},
    };

    const payload = {
      subdomains: ['api.example.com'],
      rawOutput: 'api.example.com',
      domainCount: 1,
      subdomainCount: 1,
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(payload);

    const result = component.outputs.parse(await component.execute(executePayload, context));

    expect(result).toEqual(component.outputs.parse(payload));
  });

  it('should accept a single domain string and normalise to array', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    const inputs = component.inputs.parse({ domains: 'example.com' });
    expect(inputs.domains).toEqual(['example.com']);
  });

  it('should accept legacy "domain" key from older workflows', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    const params = component.parameters!.parse({ domain: 'legacy.example.com' });
    expect(params.domain).toBe('legacy.example.com');
  });

  it('should pass provider config via -pc flag when configured', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    const secretValue = `providers:
  - name: shodan
    api_key: abc123`;

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-secret-test',
    });

    const executePayload = {
      inputs: {
        domains: ['example.com'],
        providerConfig: secretValue,
      },
      params: {},
    };

    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({
      subdomains: [],
      rawOutput: '',
      domainCount: 1,
      subdomainCount: 0,
    });

    await component.execute(executePayload, context);

    expect(runnerSpy).toHaveBeenCalled();
    const [runnerConfig] = runnerSpy.mock.calls[0];
    expect(runnerConfig).toBeDefined();
    if (runnerConfig && runnerConfig.kind === 'docker') {
      // After Dynamic Args Pattern refactoring, provider config is mounted as a file
      // and passed via -pc flag in the command arguments
      const command = runnerConfig.command ?? [];
      expect(command).toContain('-pc');
      // The -pc flag should be followed by the path to the provider config file
      const pcIndex = command.indexOf('-pc');
      expect(pcIndex).toBeGreaterThan(-1);
      expect(command[pcIndex + 1]).toContain('provider-config.yaml');
      // Volume should be configured
      expect(runnerConfig.volumes).toBeDefined();
      expect(runnerConfig.volumes?.length).toBeGreaterThan(0);
    }
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>(
      'shipsec.subfinder.run',
    );
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/subfinder:v2.12.0');
    }
  });
});
