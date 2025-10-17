import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../index';

describe('subfinder component', () => {
  beforeAll(() => {
    require('../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    expect(component).toBeDefined();
    expect(component?.label).toBe('Subfinder');
    expect(component?.category).toBe('discovery');
  });

  it('should normalise raw output returned as plain text', async () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const params = component.inputSchema.parse({
      domains: ['example.com'],
    });

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('api.example.com\napp.example.com');

    const result = await component.execute(params, context) as any;

    expect(result.subdomains).toEqual(['api.example.com', 'app.example.com']);
    expect(result.rawOutput).toBe('api.example.com\napp.example.com');
    expect(result.domainCount).toBe(1);
    expect(result.subdomainCount).toBe(2);
  });

  it('should return structured output when docker emits JSON', async () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
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

    const result = await component.execute(params, context) as any;

    expect(result).toEqual(payload);
  });

  it('should use docker runner config', () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/subfinder:latest');
    }
  });
});
