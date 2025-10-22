/**
 * Integration test for Subfinder component with real Docker execution
 * Requires Docker daemon to be running
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';
import type { ExecutionContext } from '@shipsec/component-sdk';
import type { SubfinderInput, SubfinderOutput } from '../subfinder';
import '../subfinder'; // Register the component

const enableDockerIntegration = process.env.ENABLE_DOCKER_TESTS === 'true';
const dockerAvailable = (() => {
  try {
    const result = Bun.spawnSync(['docker', 'version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

const shouldRunDockerTests = enableDockerIntegration && dockerAvailable;
if (!shouldRunDockerTests) {
  console.warn(
    'Skipping subfinder integration tests. Ensure ENABLE_DOCKER_TESTS=true and Docker is available to enable.',
  );
}

const dockerDescribe = shouldRunDockerTests ? describe : describe.skip;

dockerDescribe('Subfinder Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'shipsec.subfinder.run',
      logCollector: (entry) => {
        logs.push(`${entry.stream.toUpperCase()}: ${entry.message}`);
      },
    });
  });

  test('should discover subdomains for a known domain using real subfinder', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    expect(component).toBeDefined();

    const typedComponent = component!;
    const params = typedComponent.inputSchema.parse({ domains: ['example.com'] });

    const result = typedComponent.outputSchema.parse(await typedComponent.execute(params, context));

    console.log('Subfinder result:', result);

    // Verify output structure
    expect(result).toHaveProperty('subdomains');
    expect(result).toHaveProperty('rawOutput');
    expect(result).toHaveProperty('domainCount');
    expect(result).toHaveProperty('subdomainCount');
    expect(Array.isArray(result.subdomains)).toBe(true);
    expect(typeof result.rawOutput).toBe('string');
    expect(typeof result.domainCount).toBe('number');
    expect(typeof result.subdomainCount).toBe('number');
    
    // Subfinder might find 0 subdomains for example.com (it's protected)
    // but should still return valid structure
    expect(result.domainCount).toBe(1);

    // Check logs
    expect(logs.some(log => log.includes('subfinder'))).toBe(true);
  }, 120000); // 2 minute timeout for Docker pull + execution

  test('should handle invalid domain gracefully', async () => {
    const component = componentRegistry.get<SubfinderInput, SubfinderOutput>('shipsec.subfinder.run');
    const typedComponent = component!;
    const params = typedComponent.inputSchema.parse({
      domains: ['this-domain-definitely-does-not-exist-12345.invalid'],
    });

    const result = typedComponent.outputSchema.parse(await typedComponent.execute(params, context));

    expect(result).toHaveProperty('subdomains');
    expect(Array.isArray(result.subdomains)).toBe(true);
    expect(result.domainCount).toBe(1);
  }, 120000);
});
