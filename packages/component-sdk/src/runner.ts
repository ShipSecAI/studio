import { spawn } from 'child_process';
import { mkdtemp, rm, readFile, writeFile, access, constants } from 'fs/promises';

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
let cachedDockerPath: string | null = null;

export async function resolveDockerPath(context?: ExecutionContext): Promise<string> {
  if (cachedDockerPath) return cachedDockerPath;

  const commonPaths = [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/usr/bin/docker',
    '/bin/docker',
  ];

  for (const path of commonPaths) {
    try {
      await access(path, constants.X_OK);
      context?.logger.debug(`[Docker] Resolved docker path to: ${path}`);
      cachedDockerPath = path;
      return path;
    } catch {
      // Continue to next path
    }
  }

  // Fallback to searching in PATH
  context?.logger.info(`[Docker] Checked common paths but could not find docker. Fallback to using "docker" from PATH.`);
  cachedDockerPath = 'docker';
  return 'docker';
}



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

  // Create temp directory for output and input
  const outputDir = await mkdtemp(join(tmpdir(), 'shipsec-run-'));
  const hostOutputPath = join(outputDir, OUTPUT_FILENAME);
  const hostInputPath = join(outputDir, 'input.json');

  try {
    // Write inputs to file instead of passing via env or stdin
    await writeFile(hostInputPath, JSON.stringify(params));

    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--network', network,
      // Mount the directory containing both input and output
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

    // Tell the container where to read input and write output
    dockerArgs.push('-e', `SHIPSEC_INPUT_PATH=${CONTAINER_OUTPUT_PATH}/input.json`);
    dockerArgs.push('-e', `SHIPSEC_OUTPUT_PATH=${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`);

    if (entrypoint) {
      dockerArgs.push('--entrypoint', entrypoint);
    }

    dockerArgs.push(image, ...command);


    const useTerminal = Boolean(context.terminalCollector);
    let capturedStdout = '';
    
    if (useTerminal) {
      // Remove -i flag for PTY mode (stdin not needed with TTY)
      const argsWithoutStdin = dockerArgs.filter(arg => arg !== '-i');
      if (!argsWithoutStdin.includes('-t')) {
        argsWithoutStdin.splice(2, 0, '-t');
      }
      // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
      capturedStdout = await runDockerWithPty(argsWithoutStdin, params, context, timeoutSeconds);
    } else {
      capturedStdout = await runDockerWithStandardIO(dockerArgs, params, context, timeoutSeconds, runner.stdinJson);
    }


    // Read output from file (with stdout fallback for legacy components)
    return await readOutputFromFile<O>(hostOutputPath, capturedStdout, context);
  } finally {
    // Cleanup temp directory
    await rm(outputDir, { recursive: true, force: true }).catch((err) => {
      context.logger.warn(`[Docker] Failed to cleanup temp directory ${outputDir}: ${err.message}`);
    });
  }
}

/**
 * Read component output from the mounted output file.
 * If file doesn't exist, falls back to stdout parsing for backwards compatibility.
 * 
 * @param filePath Path to the output file
 * @param stdout Captured stdout as fallback for legacy components
 * @param context Execution context for logging
 */
async function readOutputFromFile<O>(
  filePath: string, 
  stdout: string,
  context: ExecutionContext
): Promise<O> {
  // First, try to read from the output file (preferred method)
  try {
    await access(filePath, constants.R_OK);
    const content = await readFile(filePath, 'utf8');
    const output = JSON.parse(content.trim());
    context.logger.info(`[Docker] Read output from file (${content.length} bytes)`);
    return output as O;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        context.logger.error(`[Docker] Failed to parse output JSON: ${error.message}`);
        throw new ValidationError(`Failed to parse container output as JSON: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    // File not found - fall through to stdout fallback
  }

  // Fallback: Use stdout (for backwards compatibility with legacy components)
  // This allows components that just write to stdout to continue working.
  if (stdout.trim().length > 0) {
    context.logger.info(`[Docker] No output file found, using stdout fallback (${stdout.length} bytes)`);
    
    // Try to parse stdout as JSON
    try {
      const output = JSON.parse(stdout.trim());
      return output as O;
    } catch {
      // Not JSON - return raw string as output
      // This handles components like subfinder that output plain text
      return stdout.trim() as unknown as O;
    }
  }

  // No output file and no stdout - return empty object
  context.logger.warn('[Docker] No output file or stdout, returning empty result');
  return {} as O;
}

/**
 * Run Docker container with standard I/O.
 * Stdout/stderr are collected - stdout is returned for backwards compatibility.
 * Primary output method is the mounted output file.
 */
async function runDockerWithStandardIO<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
  stdinJson?: boolean,
): Promise<string> {
  const dockerPath = await resolveDockerPath(context);
  return new Promise<string>((resolve, reject) => {
    const stdoutEmitter = createTerminalChunkEmitter(context, 'stdout');
    const stderrEmitter = createTerminalChunkEmitter(context, 'stderr');

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new TimeoutError(`Docker container timed out after ${timeoutSeconds}s`, timeoutSeconds * 1000, {
        details: { dockerArgs: formatArgs(dockerArgs) },
      }));
    }, timeoutSeconds * 1000);

    const proc = spawn(dockerPath, dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });



    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdoutEmitter(data);
      const chunk = data.toString();
      stdout += chunk; // Capture for fallback
      
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
      
      // Return captured stdout for fallback processing
      resolve(stdout);
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
 * Returns captured stdout for backwards compatibility.
 */
async function runDockerWithPty<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
): Promise<string> {
  const spawnPty = await loadPtySpawn();
  if (!spawnPty) {
    context.logger.warn('[Docker][PTY] node-pty unavailable; falling back to standard IO');
    // Remove -t flag before falling back to standard IO (stdin is not a TTY)
    const argsWithoutTty = dockerArgs.filter(arg => arg !== '-t');
    return runDockerWithStandardIO(argsWithoutTty, params, context, timeoutSeconds);
  }

  const dockerPath = await resolveDockerPath(context);
  return new Promise<string>((resolve, reject) => {
    const emitChunk = createTerminalChunkEmitter(context, 'pty');
    let stdout = '';

    let ptyProcess: ReturnType<typeof spawnPty>;
    try {
      // Debug: Log the full docker command
      context.logger.info(`[Docker][PTY] Spawning: ${dockerPath} ${formatArgs(dockerArgs)}`);

      ptyProcess = spawnPty(dockerPath, dockerArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        env: process.env as Record<string, string>,
      });
    } catch (error) {
      const diag = {
        dockerPath,
        pathEnv: process.env.PATH,
        cwd: process.cwd(),
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          // @ts-ignore
          code: error.code,
        } : String(error)
      };
      
      console.log('diag', diag);
      context.logger.warn(
        `[Docker][PTY] Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}. Diagnostic: ${JSON.stringify(diag)}`,
      );
      context.logger.warn('[Docker][PTY] Falling back to standard IO due to PTY spawn failure');
      
      // Remove -t flag before falling back (stdin is not a TTY)
      const argsWithoutTty = dockerArgs.filter((arg) => arg !== '-t');
      resolve(runDockerWithStandardIO(argsWithoutTty, params, context, timeoutSeconds));
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
      stdout += data; // Capture for fallback
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

      // Return captured stdout for fallback processing
      resolve(stdout);
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
