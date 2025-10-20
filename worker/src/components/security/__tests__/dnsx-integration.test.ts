/**
 * Integration test for DNSX component with real Docker execution
 * Requires Docker daemon to be running
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '@shipsec/component-sdk';
import '../dnsx';

describe('DNSX Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = {
      runId: 'test-run',
      componentRef: 'shipsec.dnsx.run',
      logger: {
        info: (...args: unknown[]) => {
          const msg = args.join(' ');
          logs.push(`INFO: ${msg}`);
          console.log(msg);
        },
        error: (...args: unknown[]) => {
          const msg = args.join(' ');
          logs.push(`ERROR: ${msg}`);
          console.error(msg);
        },
      },
      emitProgress: (progress) => {
        const message = typeof progress === 'string' ? progress : progress.message;
        logs.push(`PROGRESS: ${message}`);
        console.log(`Progress: ${message}`);
      },
    };
  });

  test(
    'should resolve DNS records for a known domain using real dnsx',
    async () => {
      const component = componentRegistry.get('shipsec.dnsx.run');
      expect(component).toBeDefined();

      const params = { domains: ['example.com'], recordTypes: ['A'] };
      const result = await component!.execute(params as any, context);

      expect(result).toHaveProperty('results');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.rawOutput.length).toBeGreaterThan(0);
      expect(result.domainCount).toBe(1);
      expect(result.recordCount).toBeGreaterThan(0);
      expect(result.results[0].host).toBe('example.com');
    },
    180_000,
  );

  test(
    'should handle non-existent domains gracefully',
    async () => {
      const component = componentRegistry.get('shipsec.dnsx.run');
      expect(component).toBeDefined();

      const params = {
        domains: ['this-domain-definitely-does-not-exist-12345.invalid'],
        recordTypes: ['A'],
      };

      const result = await component!.execute(params as any, context);

      expect(result.domainCount).toBe(1);
      expect(result.recordTypes).toContain('A');
      expect(Array.isArray(result.results)).toBe(true);
    },
    180_000,
  );
});
