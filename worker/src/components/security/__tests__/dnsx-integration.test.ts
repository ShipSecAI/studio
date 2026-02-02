/**
 * Integration test for DNSX component with real Docker execution
 * Requires Docker daemon to be running
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';
import type { DnsxInput, DnsxOutput } from '../dnsx';
import '../dnsx';

const enableDockerIntegration = process.env.ENABLE_DOCKER_TESTS === 'true';
const dockerDescribe = enableDockerIntegration ? describe : describe.skip;

dockerDescribe('DNSX Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'shipsec.dnsx.run',
      logCollector: (entry) => {
        logs.push(`${entry.stream.toUpperCase()}: ${entry.message}`);
      },
    });
  });

  test('should resolve DNS records for a known domain using real dnsx', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    expect(component).toBeDefined();

    const typedComponent = component!;

    const result = typedComponent.outputs.parse(
      await typedComponent.execute(
        {
          inputs: { domains: ['example.com'] },
          params: { recordTypes: ['A'] },
        },
        context,
      ),
    );

    expect(result).toHaveProperty('results');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.rawOutput.length).toBeGreaterThan(0);
    expect(result.domainCount).toBe(1);
    expect(result.recordCount).toBeGreaterThan(0);
    expect(result.results[0].host).toBe('example.com');
  }, 180_000);

  test('should handle non-existent domains gracefully', async () => {
    const component = componentRegistry.get<DnsxInput, DnsxOutput>('shipsec.dnsx.run');
    expect(component).toBeDefined();

    const typedComponent = component!;

    const result = typedComponent.outputs.parse(
      await typedComponent.execute(
        {
          inputs: { domains: ['this-domain-definitely-does-not-exist-12345.invalid'] },
          params: { recordTypes: ['A'] },
        },
        context,
      ),
    );

    expect(result.domainCount).toBe(1);
    expect(result.recordTypes).toContain('A');
    expect(Array.isArray(result.results)).toBe(true);
  }, 180_000);
});
