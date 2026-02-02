import { describe, test, expect, beforeEach } from 'bun:test';
import { runComponentWithRunner } from '../runner';
import type { ExecutionContext, DockerRunnerConfig } from '../types';

const enableDockerRunnerTests = process.env.ENABLE_DOCKER_TESTS === 'true';

// Skip docker-dependent tests when Docker CLI is unavailable.
const dockerAvailable = (() => {
  try {
    const result = Bun.spawnSync(['docker', 'version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

const dockerDescribe =
  enableDockerRunnerTests && dockerAvailable ? describe : describe.skip;
const dockerTest =
  enableDockerRunnerTests && dockerAvailable ? test : test.skip;

dockerDescribe('Docker Runner', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = {
      runId: 'test-run',
      componentRef: 'test-component',
      metadata: {
        runId: 'test-run',
        componentRef: 'test-component',
      },
      logger: {
        debug: (...args: unknown[]) => logs.push(`DEBUG: ${args.join(' ')}`),
        info: (...args: unknown[]) => logs.push(`INFO: ${args.join(' ')}`),
        warn: (...args: unknown[]) => logs.push(`WARN: ${args.join(' ')}`),
        error: (...args: unknown[]) => logs.push(`ERROR: ${args.join(' ')}`),
      },
      emitProgress: (progress) => {
        const message = typeof progress === 'string' ? progress : progress.message;
        logs.push(`PROGRESS: ${message}`);
      },
      http: {
        fetch: async (input, init) => fetch(input as any, init),
        toCurl: () => '',
      },
    };
  });

  const BUSYBOX_IMAGE = 'busybox:1.36';

  dockerTest('should execute simple echo command in busybox container', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: BUSYBOX_IMAGE,
      command: ['/bin/sh', '-c', 'echo "Hello from Docker!"'],
      timeoutSeconds: 30,
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    const result = await runComponentWithRunner<typeof params, string>(
      runner,
      dummyExecute,
      params,
      context,
    );

    expect(result).toBe('Hello from Docker!');
    expect(logs.some(log => log.includes(BUSYBOX_IMAGE))).toBe(true);
    expect(logs.some(log => log.includes('Completed successfully'))).toBe(true);
  });

  dockerTest('should handle JSON output from container', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: BUSYBOX_IMAGE,
      command: ['/bin/sh', '-c', 'echo \'{"result":"test-value"}\''],
      timeoutSeconds: 30,
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    const result = await runComponentWithRunner<typeof params, { result: string }>(
      runner,
      dummyExecute,
      params,
      context,
    );

    expect(result).toEqual({ result: 'test-value' });
  });

  dockerTest('should pass environment variables to container', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: BUSYBOX_IMAGE,
      command: ['/bin/sh', '-c', 'echo $TEST_VAR'],
      env: { TEST_VAR: 'environment-works' },
      timeoutSeconds: 30,
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    const result = await runComponentWithRunner<typeof params, string>(
      runner,
      dummyExecute,
      params,
      context,
    );

    expect(result).toBe('environment-works');
  });

  dockerTest('should handle container errors gracefully', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: BUSYBOX_IMAGE,
      command: ['/bin/sh', '-c', 'exit 1'], // Force error
      timeoutSeconds: 30,
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    await expect(
      runComponentWithRunner(runner, dummyExecute, params, context),
    ).rejects.toThrow('exit code 1');
  });

  dockerTest('should timeout long-running containers', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: BUSYBOX_IMAGE,
      command: ['/bin/sh', '-c', 'sleep 10'],
      timeoutSeconds: 1, // 1 second timeout
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    await expect(
      runComponentWithRunner(runner, dummyExecute, params, context),
    ).rejects.toThrow('timed out');
  }, 5000); // Test timeout

  dockerTest('should handle non-existent Docker images', async () => {
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: 'this-image-does-not-exist-12345:latest',
      command: ['echo', 'hello'],
      timeoutSeconds: 30,
    };

    const params = {};
    const dummyExecute = async () => {
      throw new Error('Should not be called');
    };

    await expect(
      runComponentWithRunner(runner, dummyExecute, params, context),
    ).rejects.toThrow();
  }, 10000); // Give it time to fail
});
