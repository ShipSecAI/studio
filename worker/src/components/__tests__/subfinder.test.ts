import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../index';

describe('subfinder component', () => {
  beforeAll(() => {
    require('../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    expect(component).toBeDefined();
    expect(component?.label).toBe('Subfinder');
    expect(component?.category).toBe('discovery');
  });

  it('should return stubbed subdomains', async () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'subfinder-test',
    });

    const params = component.inputSchema.parse({
      domain: 'example.com',
    });

    const result = await component.execute(params, context) as any;

    expect(result.subdomains).toEqual(['api.example.com', 'app.example.com']);
    expect(result.rawOutput).toBe('api.example.com\napp.example.com');
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

