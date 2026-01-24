import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('sqlmap component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    expect(component).toBeDefined();
    expect(component!.label).toBe('SQLMap Scanner');
    expect(component!.category).toBe('security');
  });

  it('should use docker runner with shell wrapper', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    expect(component!.runner.kind).toBe('docker');
    if (component!.runner.kind === 'docker') {
      expect(component!.runner.entrypoint).toBe('sh');
      expect(component!.runner.command).toContain('-c');
      expect(component!.runner.image).toBe('googlesky/sqlmap:latest');
    }
  });

  it('should handle empty target URL gracefully', async () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'sqlmap-test',
    });

    const result = await component.execute(
      {
        inputs: { targetUrl: '' },
        params: {},
      },
      context,
    );

    const parsed = component.outputs.parse(result);
    expect(parsed.vulnerable).toBe(false);
    expect(parsed.injectionPoints).toEqual([]);
    expect(parsed.databases).toEqual([]);
  });

  it('should have correct input schema', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    const validInput = { targetUrl: 'http://example.com/page.php?id=1' };
    const parsed = component.inputs.parse(validInput);
    expect(parsed.targetUrl).toBe('http://example.com/page.php?id=1');
  });

  it('should reject invalid URL', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    expect(() => component.inputs.parse({ targetUrl: 'not-a-url' })).toThrow();
  });

  it('should have correct parameter schema with defaults', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component || !component.parameters) throw new Error('Component not registered');

    const parsed = component.parameters.parse({});
    expect(parsed.level).toBe('1');
    expect(parsed.risk).toBe('1');
    expect(parsed.technique).toBe('BEUSTQ');
    expect(parsed.threads).toBe(1);
    expect(parsed.timeout).toBe(30);
    expect(parsed.randomAgent).toBe(true);
    expect(parsed.getBanner).toBe(true);
    expect(parsed.getCurrentUser).toBe(true);
    expect(parsed.getCurrentDb).toBe(true);
    expect(parsed.isDba).toBe(false);
    expect(parsed.getDbs).toBe(false);
    expect(parsed.getTables).toBe(false);
  });

  it('should have correct output schema', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    const validOutput = {
      vulnerable: true,
      injectionPoints: [
        {
          parameter: 'id',
          place: 'GET',
          dbms: 'MySQL',
          dbmsVersion: ['5.x'],
          os: 'Linux',
          techniques: [
            {
              type: 'boolean-based blind',
              title: 'AND boolean-based blind',
              payload: 'id=1 AND 1=1',
            },
          ],
        },
      ],
      banner: 'MySQL 5.7.32',
      currentUser: 'root@localhost',
      currentDb: 'testdb',
      isDba: true,
      databases: ['information_schema', 'mysql', 'testdb'],
      tables: ['users', 'products'],
      rawOutput: 'sqlmap output...',
      scanInfo: {
        targetUrl: 'http://example.com/page.php?id=1',
        level: '1',
        risk: '1',
        technique: 'BEUSTQ',
        threads: 1,
      },
    };

    const parsed = component.outputs.parse(validOutput) as typeof validOutput;
    expect(parsed.vulnerable).toBe(true);
    expect(parsed.injectionPoints.length).toBe(1);
    expect(parsed.injectionPoints[0].parameter).toBe('id');
    expect(parsed.banner).toBe('MySQL 5.7.32');
  });

  it('should have retry policy configured', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.retryPolicy).toBeDefined();
    expect(component.retryPolicy?.maxAttempts).toBe(2);
    expect(component.retryPolicy?.nonRetryableErrorTypes).toContain('ContainerError');
    expect(component.retryPolicy?.nonRetryableErrorTypes).toContain('ValidationError');
  });

  it('should have UI metadata configured', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.ui).toBeDefined();
    expect(component.ui?.slug).toBe('sqlmap');
    expect(component.ui?.category).toBe('security');
    expect(component.ui?.icon).toBe('Database');
    expect(component.ui?.documentationUrl).toBe('https://sqlmap.org/');
  });

  it('should validate level enum', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component || !component.parameters) throw new Error('Component not registered');

    const validLevels = ['1', '2', '3', '4', '5'];
    for (const level of validLevels) {
      const parsed = component.parameters.parse({ level });
      expect(parsed.level).toBe(level);
    }

    expect(() => component.parameters.parse({ level: '6' })).toThrow();
  });

  it('should validate risk enum', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component || !component.parameters) throw new Error('Component not registered');

    const validRisks = ['1', '2', '3'];
    for (const risk of validRisks) {
      const parsed = component.parameters.parse({ risk });
      expect(parsed.risk).toBe(risk);
    }

    expect(() => component.parameters.parse({ risk: '4' })).toThrow();
  });

  it('should validate technique enum', () => {
    const component = componentRegistry.get('shipsec.sqlmap.scan');
    if (!component || !component.parameters) throw new Error('Component not registered');

    const validTechniques = ['B', 'E', 'U', 'S', 'T', 'Q', 'BEUSTQ'];
    for (const technique of validTechniques) {
      const parsed = component.parameters.parse({ technique });
      expect(parsed.technique).toBe(technique);
    }

    expect(() => component.parameters.parse({ technique: 'X' })).toThrow();
  });
});
