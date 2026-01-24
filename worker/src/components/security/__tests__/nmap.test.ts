import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('nmap component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Nmap Scanner');
    expect(component!.category).toBe('security');
  });

  it('should use docker runner with shell wrapper', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    expect(component!.runner.kind).toBe('docker');
    if (component!.runner.kind === 'docker') {
      expect(component!.runner.entrypoint).toBe('sh');
      expect(component!.runner.command).toContain('-c');
      expect(component!.runner.command).toContain('nmap "$@"');
      expect(component!.runner.image).toBe('securecodebox/nmap:latest');
    }
  });

  it('should use securecodebox nmap image', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (component!.runner.kind === 'docker') {
      expect(component!.runner.image).toBe('securecodebox/nmap:latest');
    }
  });

  it('should handle empty targets gracefully', async () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'nmap-test',
    });

    const result = await component.execute(
      {
        inputs: { targets: ['   ', ''] },
        params: {},
      },
      context,
    );

    const parsed = component.outputs.parse(result);
    expect(parsed.hosts).toEqual([]);
    expect(parsed.hostCount).toBe(0);
    expect(parsed.openPortCount).toBe(0);
  });

  it('should have correct input schema', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    // Test that inputs schema validates correctly
    const validInput = { targets: ['192.168.1.1', 'scanme.nmap.org'] };
    const parsed = component.inputs.parse(validInput);
    expect(parsed.targets).toEqual(['192.168.1.1', 'scanme.nmap.org']);
  });

  it('should have correct parameter schema with defaults', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    // Test that parameters schema has correct defaults
    const parsed = component.parameters.parse({});
    expect(parsed.scanType).toBe('default');
    expect(parsed.timing).toBe('T3');
    expect(parsed.serviceDetection).toBe(false);
    expect(parsed.osDetection).toBe(false);
    expect(parsed.scriptScan).toBe(false);
    expect(parsed.aggressiveScan).toBe(false);
    expect(parsed.pingDiscovery).toBe(true);
    expect(parsed.dnsResolution).toBe(true);
  });

  it('should have correct output schema', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    // Test that output schema validates correctly
    const validOutput = {
      hosts: [
        {
          ip: '192.168.1.1',
          hostname: 'router.local',
          state: 'up',
          ports: [
            {
              port: 22,
              protocol: 'tcp',
              state: 'open',
              service: 'ssh',
              version: '8.0',
              product: 'OpenSSH',
              extraInfo: null,
            },
          ],
          os: 'Linux 4.x',
          osAccuracy: 95,
        },
      ],
      rawOutput: '<xml>...</xml>',
      targetCount: 1,
      hostCount: 1,
      openPortCount: 1,
      scanInfo: {
        scanType: 'default',
        timing: 'T3',
        serviceDetection: false,
        osDetection: false,
        scriptScan: false,
      },
    };

    const parsed = component.outputs.parse(validOutput);
    expect(parsed.hosts.length).toBe(1);
    expect(parsed.hosts[0].ip).toBe('192.168.1.1');
    expect(parsed.hosts[0].ports[0].port).toBe(22);
  });

  it('should have retry policy configured', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.retryPolicy).toBeDefined();
    expect(component.retryPolicy?.maxAttempts).toBe(2);
    expect(component.retryPolicy?.nonRetryableErrorTypes).toContain('ContainerError');
    expect(component.retryPolicy?.nonRetryableErrorTypes).toContain('ValidationError');
  });

  it('should have UI metadata configured', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    expect(component.ui).toBeDefined();
    expect(component.ui?.slug).toBe('nmap');
    expect(component.ui?.category).toBe('security');
    expect(component.ui?.icon).toBe('Radar');
    expect(component.ui?.documentationUrl).toBe('https://nmap.org/');
  });

  it('should validate scan type enum', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    // Valid scan types should pass
    const validTypes = [
      'default',
      'syn',
      'connect',
      'udp',
      'ack',
      'window',
      'maimon',
      'null',
      'fin',
      'xmas',
    ];
    for (const scanType of validTypes) {
      const parsed = component.parameters.parse({ scanType });
      expect(parsed.scanType).toBe(scanType);
    }

    // Invalid scan type should fail
    expect(() => component.parameters.parse({ scanType: 'invalid' })).toThrow();
  });

  it('should validate timing template enum', () => {
    const component = componentRegistry.get('shipsec.nmap.scan');
    if (!component) throw new Error('Component not registered');

    // Valid timing templates should pass
    const validTimings = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
    for (const timing of validTimings) {
      const parsed = component.parameters.parse({ timing });
      expect(parsed.timing).toBe(timing);
    }

    // Invalid timing should fail
    expect(() => component.parameters.parse({ timing: 'T6' })).toThrow();
  });
});
