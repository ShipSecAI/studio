/**
 * Integration test for Katana component with real Docker execution
 * Requires Docker daemon to be running
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { componentRegistry, createExecutionContext } from '@shipsec/component-sdk';
import type { ExecutionContext } from '@shipsec/component-sdk';
import type { KatanaInput, KatanaOutput } from '../katana';
import '../katana'; // Register the component

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
    'Skipping katana integration tests. Ensure ENABLE_DOCKER_TESTS=true and Docker is available to enable.',
  );
}

const dockerDescribe = shouldRunDockerTests ? describe : describe.skip;

dockerDescribe('Katana Integration (Docker)', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'shipsec.katana.crawl',
      logCollector: (entry) => {
        logs.push(`${entry.stream.toUpperCase()}: ${entry.message}`);
      },
    });
  });

  test('should crawl urls for a known domain using real katana', async () => {
    const component = componentRegistry.get<KatanaInput, KatanaOutput>('shipsec.katana.crawl')!;
    expect(component).toBeDefined();

    const result = await component.execute(
      {
        inputs: { urls: ['https://example.com'] },
        params: { depth: 1 },
      },
      context,
    );

    console.log('Katana result:', result);

    // Verify output structure
    expect(result).toHaveProperty('crawledUrls');
    expect(result).toHaveProperty('rawOutput');
    expect(result).toHaveProperty('targetCount');
    expect(result).toHaveProperty('urlCount');
    expect(Array.isArray(result.crawledUrls)).toBe(true);
    expect(typeof result.rawOutput).toBe('string');
    expect(typeof result.targetCount).toBe('number');
    expect(typeof result.urlCount).toBe('number');

    expect(result.targetCount).toBe(1);

    // Check logs
    expect(logs.some((log) => log.includes('katana'))).toBe(true);
  }, 120000);
});
