import { spawn } from 'child_process';
import { mkdtemp, rm, readFile, access, constants } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ExecutionContext, RunnerConfig, DockerRunnerConfig } from './types';
import { createTerminalChunkEmitter } from './terminal';
import { ContainerError, TimeoutError, ValidationError, ConfigurationError } from './errors';

// Standard output file path inside the container
const CONTAINER_OUTPUT_PATH = '/shipsec-output';
const OUTPUT_FILENAME = 'result.json';

type PtySpawn = typeof import('node-pty')['spawn'];
let cachedPtySpawn: PtySpawn | null = null;

function formatArgs(args: string[]): string {
  return args
    .map((part, index) => {
      if (!part) {
        return '';
      }
      const hasNewlines = part.includes('\n');
      const isLong = part.length > 120;
      if (hasNewlines || isLong) {
        return `<arg-${index}:${part.length} chars>`;
      }
      return part;
    })
    .join(' ');
}

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
 * - Mounts a temp directory for structured output at /shipsec-output
 * - Components should write results to /shipsec-output/result.json
 * - Stdout/stderr are used purely for logging/progress
 * - Automatically cleans up container and temp directory on exit
 */
async function runComponentInDocker<I, O>(
  runner: DockerRunnerConfig,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  const { image, command, entrypoint, env = {}, network = 'none', platform, volumes, timeoutSeconds = 300 } = runner;

  context.logger.info(`[Docker] Running ${image} with command: ${formatArgs(command)}`);
  context.emitProgress(`Starting Docker container: ${image}`);

  // Create temp directory for output
  const outputDir = await mkdtemp(join(tmpdir(), 'shipsec-run-'));
  const hostOutputPath = join(outputDir, OUTPUT_FILENAME);

  try {
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--network', network,
      // Mount the output directory
      '-v', `${outputDir}:${CONTAINER_OUTPUT_PATH}`,
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

    // Tell the container where to write output
    dockerArgs.push('-e', `SHIPSEC_OUTPUT_PATH=${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`);

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
      await runDockerWithPty(argsWithoutStdin, params, context, timeoutSeconds);
    } else {
      await runDockerWithStandardIO(dockerArgs, params, context, timeoutSeconds);
    }

    // Read output from file
    return await readOutputFromFile<O>(hostOutputPath, context);
  } finally {
    // Cleanup temp directory
    await rm(outputDir, { recursive: true, force: true }).catch((err) => {
      context.logger.warn(`[Docker] Failed to cleanup temp directory ${outputDir}: ${err.message}`);
    });
  }
}

/**
 * Read component output from the mounted output file.
 * Falls back to empty object if file doesn't exist.
 */
async function readOutputFromFile<O>(filePath: string, context: ExecutionContext): Promise<O> {
  try {
    await access(filePath, constants.R_OK);
    const content = await readFile(filePath, 'utf8');
    const output = JSON.parse(content.trim());
    context.logger.info(`[Docker] Read output from file (${content.length} bytes)`);
    return output as O;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      context.logger.warn('[Docker] No output file found, returning empty result');
      return {} as O;
    }
    if (error instanceof SyntaxError) {
      context.logger.error(`[Docker] Failed to parse output JSON: ${error.message}`);
      throw new ValidationError(`Failed to parse container output as JSON: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Run Docker container with standard I/O.
 * Stdout/stderr are collected for logging only.
 * Output is read from the mounted output file after container exits.
 */
function runDockerWithStandardIO<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
  stdinJson?: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stdoutEmitter = createTerminalChunkEmitter(context, 'stdout');
    const stderrEmitter = createTerminalChunkEmitter(context, 'stderr');

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new TimeoutError(`Docker container timed out after ${timeoutSeconds}s`, timeoutSeconds * 1000, {
        details: { dockerArgs: formatArgs(dockerArgs) },
      }));
    }, timeoutSeconds * 1000);

    const proc = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdoutEmitter(data);
      const chunk = data.toString();
      
      // Send to log collector (which has chunking support)
      const logEntry = {
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stdout' as const,
        level: 'info' as const,
        message: chunk,
        timestamp: new Date().toISOString(),
      };
      context.logCollector?.(logEntry);
      
      // NOTE: We intentionally do NOT emit stdout as trace progress events.
      // Output data is written to /shipsec-output/result.json by the container.
      // Stdout should only contain logs and progress messages from the component.
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
      // Only emit actual error messages as progress, not raw data
      if (chunk.trim().length > 0 && chunk.trim().length < 500) {
        context.emitProgress({
          message: chunk.trim(),
          level: 'error',
          data: { stream: 'stderr', origin: 'docker' },
        });
      }

      console.error(`[${context.componentRef}] [Docker] stderr: ${chunk.trim()}`);
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      context.logger.error(`[Docker] Failed to start: ${error.message}`);
      reject(new ContainerError(`Failed to start Docker container: ${error.message}`, {
        cause: error,
        details: { dockerArgs: formatArgs(dockerArgs) },
      }));
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
          data: { exitCode: code, stderr: stderr.slice(0, 500) },
        });

        reject(new ContainerError(`Docker container failed with exit code ${code}: ${stderr}`, {
          details: { exitCode: code, stderr, dockerArgs: formatArgs(dockerArgs) },
        }));
        return;
      }

      context.logger.info(`[Docker] Completed successfully`);
      context.emitProgress('Docker container completed');
      
      // Output will be read from file by the caller
      resolve();
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
        reject(new ValidationError(`Failed to write input to Docker container: ${e}`, {
          cause: e as Error,
          details: { inputType: typeof params },
        }));
      }
    } else {
      // Close stdin immediately if stdinJson is false
      proc.stdin.end();
    }
  });
}

/**
 * Run Docker container with PTY (pseudo-terminal).
 * Used when terminal streaming is enabled for interactive output.
 * Output is read from the mounted output file after container exits.
 */
async function runDockerWithPty<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
): Promise<void> {
  const spawnPty = await loadPtySpawn();
  if (!spawnPty) {
    context.logger.warn('[Docker][PTY] node-pty unavailable; falling back to standard IO');
    // Remove -t flag before falling back to standard IO (stdin is not a TTY)
    const argsWithoutTty = dockerArgs.filter(arg => arg !== '-t');
    return runDockerWithStandardIO(argsWithoutTty, params, context, timeoutSeconds);
  }

  return new Promise<void>((resolve, reject) => {
    const emitChunk = createTerminalChunkEmitter(context, 'pty');

    let ptyProcess: ReturnType<typeof spawnPty>;
    try {
      // Debug: Log the full docker command
      context.logger.info(`[Docker][PTY] Spawning: docker ${formatArgs(dockerArgs)}`);

      ptyProcess = spawnPty('docker', dockerArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
      });
    } catch (error) {
      reject(
        new ContainerError(
          `Failed to spawn Docker PTY: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            details: { dockerArgs: formatArgs(dockerArgs) },
          },
        ),
      );
      return;
    }

    const timeout = setTimeout(() => {
      ptyProcess.kill();
      reject(new TimeoutError(`Docker container timed out after ${timeoutSeconds}s`, timeoutSeconds * 1000, {
        details: { dockerArgs: formatArgs(dockerArgs) },
      }));
    }, timeoutSeconds * 1000);

    // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
    // Components should use environment variables or command-line arguments instead

    ptyProcess.onData((data) => {
      emitChunk(data);
      // NOTE: We don't accumulate stdout here. Terminal output is just for display.
      // Output data is written to /shipsec-output/result.json by the container.
    });

    ptyProcess.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        context.logger.error(`[Docker][PTY] Exited with code ${exitCode}`);

        // Emit error to UI
        context.emitProgress({
          message: `Docker container failed with exit code ${exitCode}`,
          level: 'error',
          data: { exitCode },
        });

        reject(new ContainerError(
          `Docker PTY execution failed with exit code ${exitCode}`,
          {
            details: {
              exitCode,
              dockerArgs: formatArgs(dockerArgs),
            },
          },
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

      // Output will be read from file by the caller
      resolve();
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
      throw new ConfigurationError(`Unsupported runner type: ${(runner as any).kind}`, {
        configKey: 'runner.kind',
        details: { runnerKind: (runner as any).kind },
      });
  }
}
