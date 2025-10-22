/**
 * Optional integration test for Amass component.
 * Requires Docker daemon and outbound network access.
 * Enable by setting RUN_SECURITY_DOCKER_TESTS=1 or RUN_AMASS_TESTS=1.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { componentRegistry, createExecutionContext, type ExecutionContext } from '@shipsec/component-sdk';
import '../amass';

const shouldRunIntegration =
  process.env.RUN_SECURITY_DOCKER_TESTS === '1' || process.env.RUN_AMASS_TESTS === '1';

(shouldRunIntegration ? describe : describe.skip)('Amass Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'shipsec.amass.enum',
      logCollector: (entry) => {
        logs.push(`${entry.stream.toUpperCase()}: ${entry.message}`);
      },
    });
  });

  test(
    'enumerates subdomains for a known domain',
    async () => {
      const component = componentRegistry.get('shipsec.amass.enum');
      expect(component).toBeDefined();

      const params = { domains: ['owasp.org'], active: false, bruteForce: false, timeoutMinutes: 1 };
      const result = (await component!.execute(params, context)) as any;

      expect(result).toHaveProperty('subdomains');
      expect(Array.isArray(result.subdomains)).toBe(true);
      expect(result.domainCount).toBeGreaterThanOrEqual(1);
      expect(result.options.timeoutMinutes).toBe(1);
    },
    180_000,
  );
});
