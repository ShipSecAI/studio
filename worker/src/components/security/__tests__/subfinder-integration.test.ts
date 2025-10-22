/**
 * Integration test for Subfinder component with real Docker execution
 * Requires Docker daemon to be running
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import type { ExecutionContext } from '@shipsec/component-sdk';
import '../subfinder'; // Register the component

const enableDockerIntegration = process.env.ENABLE_DOCKER_TESTS === 'true';
const dockerDescribe = enableDockerIntegration ? describe : describe.skip;

dockerDescribe('Subfinder Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = {
      runId: 'test-run',
      componentRef: 'shipsec.subfinder.run',
      metadata: {
        runId: 'test-run',
        componentRef: 'shipsec.subfinder.run',
      },
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

  test('should discover subdomains for a known domain using real subfinder', async () => {
    const component = componentRegistry.get('shipsec.subfinder.run');
    expect(component).toBeDefined();

    const params = { domains: ['example.com'] };
    
    // Use the component's execute method which will handle raw output parsing
    const result = await component!.execute(params, context) as any;

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
    const component = componentRegistry.get('shipsec.subfinder.run');
    const params = { domains: ['this-domain-definitely-does-not-exist-12345.invalid'] };
    
    // Use the component's execute method which will handle raw output parsing
    const result = await component!.execute(params, context) as any;

    expect(result).toHaveProperty('subdomains');
    expect(Array.isArray(result.subdomains)).toBe(true);
    expect(result.domainCount).toBe(1);
  }, 120000);
});
