import { spawn } from 'child_process';
import type { ExecutionContext, RunnerConfig, DockerRunnerConfig } from './types';
import { createTerminalChunkEmitter } from './terminal';

type PtySpawn = typeof import('node-pty')['spawn'];
let cachedPtySpawn: PtySpawn | null = null;

async function loadPtySpawn(): Promise<PtySpawn | null> {
  if (cachedPtySpawn) {
    return cachedPtySpawn;
  }
  try {
    const mod = await import('node-pty');
    cachedPtySpawn = mod.spawn;
    return cachedPtySpawn;
  } catch (error) {
    console.warn('[Docker][PTY] node-pty module not available:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function runComponentInline<I, O>(
  execute: (params: I, context: ExecutionContext) => Promise<O>,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  return execute(params, context);
}

/**
 * Execute a component in a Docker container
 * - Starts container with specified image and command
 * - Passes input params as JSON via stdin
 * - Captures stdout as output
 * - Automatically cleans up container on exit
 */
async function runComponentInDocker<I, O>(
  runner: DockerRunnerConfig,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  const { image, command, entrypoint, env = {}, network = 'none', platform, volumes, timeoutSeconds = 300 } = runner;

  context.logger.info(`[Docker] Running ${image} with command: ${command.join(' ')}`);
  context.emitProgress(`Starting Docker container: ${image}`);

  const dockerArgs = [
    'run',
    '--rm',
    '-i',
    '--network', network,
  ];

  if (platform && platform.trim().length > 0) {
    dockerArgs.push('--platform', platform);
  }

  if (Array.isArray(volumes)) {
    for (const vol of volumes) {
      if (!vol || !vol.source || !vol.target) continue;
      const mode = vol.readOnly ? ':ro' : '';
      dockerArgs.push('-v', `${vol.source}:${vol.target}${mode}`);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push('-e', `${key}=${value}`);
  }

  if (entrypoint) {
    dockerArgs.push('--entrypoint', entrypoint);
  }

  dockerArgs.push(image, ...command);

  const useTerminal = Boolean(context.terminalCollector);
  if (useTerminal) {
    // Remove -i flag for PTY mode (stdin not needed with TTY)
    const argsWithoutStdin = dockerArgs.filter(arg => arg !== '-i');
    if (!argsWithoutStdin.includes('-t')) {
      argsWithoutStdin.splice(2, 0, '-t');
    }
    // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
    return runDockerWithPty(argsWithoutStdin, params, context, timeoutSeconds);
  }

  return runDockerWithStandardIO(dockerArgs, params, context, timeoutSeconds);
}

function runDockerWithStandardIO<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
  stdinJson?: boolean,
): Promise<O> {
  return new Promise<O>((resolve, reject) => {
    const stdoutEmitter = createTerminalChunkEmitter(context, 'stdout');
    const stderrEmitter = createTerminalChunkEmitter(context, 'stderr');

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Docker container timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdoutEmitter(data);
      const chunk = data.toString();
      stdout += chunk;
      const logEntry = {
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stdout' as const,
        level: 'info' as const,
        message: chunk,
        timestamp: new Date().toISOString(),
      };

      context.logCollector?.(logEntry);
      context.emitProgress({
        message: chunk.trim(),
        level: 'info',
        data: { stream: 'stdout', origin: 'docker' },
      });
    });

    proc.stderr.on('data', (data) => {
      stderrEmitter(data);
      const chunk = data.toString();
      stderr += chunk;
      const logEntry = {
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stderr' as const,
        level: 'error' as const,
        message: chunk,
        timestamp: new Date().toISOString(),
      };

      context.logCollector?.(logEntry);
      context.emitProgress({
        message: chunk.trim(),
        level: 'error',
        data: { stream: 'stderr', origin: 'docker' },
      });

      console.error(`[${context.componentRef}] [Docker] stderr: ${chunk.trim()}`);
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      context.logger.error(`[Docker] Failed to start: ${error.message}`);
      reject(new Error(`Failed to start Docker container: ${error.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        context.logger.error(`[Docker] Exited with code ${code}`);
        context.logger.error(`[Docker] stderr: ${stderr}`);

        // Emit error to UI
        context.emitProgress({
          message: `Docker container failed with exit code ${code}`,
          level: 'error',
          data: { exitCode: code, stderr },
        });

        reject(new Error(`Docker container failed with exit code ${code}: ${stderr}`));
        return;
      }

      context.logger.info(`[Docker] Completed successfully`);
      context.emitProgress('Docker container completed');

      try {
        const output = JSON.parse(stdout.trim());
        resolve(output as O);
      } catch (e) {
        context.logger.info(`[Docker] Raw output (not JSON): ${stdout.trim()}`);
        resolve(stdout.trim() as any);
      }
    });

    if (stdinJson !== false) {
      // Only write JSON to stdin if stdinJson is true or undefined (default behavior)
      try {
        const input = JSON.stringify(params);
        proc.stdin.write(input);
        proc.stdin.end();
      } catch (e) {
        clearTimeout(timeout);
        proc.kill();
        reject(new Error(`Failed to write input to Docker container: ${e}`));
      }
    } else {
      // Close stdin immediately if stdinJson is false
      proc.stdin.end();
    }
  });
}

async function runDockerWithPty<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
): Promise<O> {
  const spawnPty = await loadPtySpawn();
  if (!spawnPty) {
    context.logger.warn('[Docker][PTY] node-pty unavailable; falling back to standard IO');
    // Remove -t flag before falling back to standard IO (stdin is not a TTY)
    const argsWithoutTty = dockerArgs.filter(arg => arg !== '-t');
    return runDockerWithStandardIO(argsWithoutTty, params, context, timeoutSeconds);
  }

  return new Promise<O>((resolve, reject) => {
    const emitChunk = createTerminalChunkEmitter(context, 'pty');
    let stdout = '';
    let stderr = '';

    let ptyProcess: ReturnType<typeof spawnPty>;
    try {
      // Debug: Log the full docker command
      context.logger.info(`[Docker][PTY] Spawning: docker ${dockerArgs.join(' ')}`);

      ptyProcess = spawnPty('docker', dockerArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
      });
    } catch (error) {
      reject(
        new Error(
          `Failed to spawn Docker PTY: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    const timeout = setTimeout(() => {
      ptyProcess.kill();
      reject(new Error(`Docker container timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
    // Components should use environment variables or command-line arguments instead

    ptyProcess.onData((data) => {
      emitChunk(data);
      stdout += data;
    });

    ptyProcess.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        stderr = stdout;
        context.logger.error(`[Docker][PTY] Exited with code ${exitCode}`);
        context.logger.error(`[Docker][PTY] Output: ${stdout.trim()}`);

        // Emit error to UI
        context.emitProgress({
          message: `Docker container failed with exit code ${exitCode}`,
          level: 'error',
          data: { exitCode, output: stdout.trim() },
        });

        // Include the actual output in the error message
        const outputPreview = stdout.trim().slice(-500); // Last 500 chars
        reject(new Error(
          `Docker PTY execution failed with exit code ${exitCode}\n\nOutput:\n${outputPreview}`
        ));
        return;
      }

      context.logger.info('[Docker][PTY] Completed successfully');
      context.emitProgress({
        message: 'Terminal stream completed',
        level: 'info',
        data: { stream: 'pty', origin: 'docker' },
      });
      context.emitProgress('Docker container completed');

      try {
        const output = JSON.parse(stdout.trim());
        resolve(output as O);
      } catch (error) {
        context.logger.info(`[Docker][PTY] Raw output (not JSON): ${stdout.trim()}`);
        resolve(stdout.trim() as any);
      }
    });
  });
}

export async function runComponentWithRunner<I, O>(
  runner: RunnerConfig,
  execute: (params: I, context: ExecutionContext) => Promise<O>,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  switch (runner.kind) {
    case 'inline':
      return runComponentInline(execute, params, context);
    case 'docker':
      return runComponentInDocker<I, O>(runner, params, context);
    case 'remote':
      context.logger.info(`[Runner] remote execution stub for ${runner.endpoint}`);
      context.emitProgress('Remote execution not yet implemented; returning inline output');
      return runComponentInline(execute, params, context);
    default:
      throw new Error(`Unsupported runner type ${(runner as any).kind}`);
  }
}
