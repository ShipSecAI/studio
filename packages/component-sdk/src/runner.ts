import { spawn } from 'child_process';
import type { ExecutionContext, RunnerConfig, DockerRunnerConfig } from './types';

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
  const { image, command, entrypoint, env = {}, network = 'none', timeoutSeconds = 300 } = runner;
  
  context.logger.info(`[Docker] Running ${image} with command: ${command.join(' ')}`);
  context.emitProgress(`Starting Docker container: ${image}`);

  // Build docker run arguments
  const dockerArgs = [
    'run',
    '--rm', // Auto-remove container on exit
    '-i',   // Interactive (keep stdin open)
    '--network', network, // Network mode (default: none for security)
  ];

  // Add environment variables
  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push('-e', `${key}=${value}`);
  }

  // Override entrypoint if specified (must come before image)
  if (entrypoint) {
    dockerArgs.push('--entrypoint', entrypoint);
  }

  // Add image and command
  dockerArgs.push(image, ...command);

  return new Promise<O>((resolve, reject) => {
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

      // Send to log collector for Loki storage
      context.logCollector?.(logEntry);

      // Stream immediately via emitProgress for real-time UI updates
      context.emitProgress({
        message: chunk.trim(),
        level: 'info',
        data: { stream: 'stdout', origin: 'docker' }
      });
    });

    proc.stderr.on('data', (data) => {
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

      // Send to log collector for Loki storage
      context.logCollector?.(logEntry);

      // Stream immediately via emitProgress for real-time UI updates
      context.emitProgress({
        message: chunk.trim(),
        level: 'error',
        data: { stream: 'stderr', origin: 'docker' }
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
        reject(new Error(`Docker container failed with exit code ${code}: ${stderr}`));
        return;
      }

      context.logger.info(`[Docker] Completed successfully`);
      context.emitProgress('Docker container completed');

      try {
        // Try to parse stdout as JSON (component output)
        const output = JSON.parse(stdout.trim());
        resolve(output as O);
      } catch (e) {
        // If not JSON, return raw output
        context.logger.info(`[Docker] Raw output (not JSON): ${stdout.trim()}`);
        resolve(stdout.trim() as any);
      }
    });

    // Write input params as JSON to stdin
    try {
      const input = JSON.stringify(params);
      proc.stdin.write(input);
      proc.stdin.end();
    } catch (e) {
      clearTimeout(timeout);
      proc.kill();
      reject(new Error(`Failed to write input to Docker container: ${e}`));
    }
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

