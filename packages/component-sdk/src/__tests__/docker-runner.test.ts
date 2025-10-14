import { describe, test, expect, beforeEach } from 'bun:test';
import { runComponentWithRunner } from '../runner';
import type { ExecutionContext, DockerRunnerConfig } from '../types';

describe('Docker Runner', () => {
  let context: ExecutionContext;
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    context = {
      runId: 'test-run',
      componentRef: 'test-component',
      logger: {
        info: (...args: unknown[]) => logs.push(`INFO: ${args.join(' ')}`),
        error: (...args: unknown[]) => logs.push(`ERROR: ${args.join(' ')}`),
      },
      emitProgress: (progress) => {
        const message = typeof progress === 'string' ? progress : progress.message;
        logs.push(`PROGRESS: ${message}`);
      },
    };
  });

  const BUSYBOX_IMAGE = 'busybox:1.36';

  test('should execute simple echo command in busybox container', async () => {
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

  test('should handle JSON output from container', async () => {
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

  test('should pass environment variables to container', async () => {
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

  test('should handle container errors gracefully', async () => {
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

  test('should timeout long-running containers', async () => {
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

  test('should handle non-existent Docker images', async () => {
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
