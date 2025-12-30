import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { ValidationError, ConfigurationError, ContainerError } from '@shipsec/component-sdk';

const exec = promisify(execCallback);

/**
 * Manages isolated Docker volumes for multi-tenant SaaS environments.
 *
 * Features:
 * - Creates unique named volumes per tenant + run + timestamp
 * - Prevents cross-tenant data access
 * - Automatic cleanup on completion or error
 * - Supports both input files (write) and output files (read)
 *
 * Security:
 * - Each execution gets a unique volume with tenant ID in the name
 * - Volumes are labeled for tracking and auditing
 * - Automatic cleanup prevents data leakage
 */
export class IsolatedContainerVolume {
  private volumeName?: string;
  private isInitialized = false;

  constructor(
    private tenantId: string,
    private runId: string,
  ) {
    // Validate tenant ID to prevent injection attacks
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID: must contain only alphanumeric characters, hyphens, and underscores', {
        fieldErrors: { tenantId: ['must contain only alphanumeric characters, hyphens, and underscores'] },
      });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      throw new ValidationError('Invalid run ID: must contain only alphanumeric characters, hyphens, and underscores', {
        fieldErrors: { runId: ['must contain only alphanumeric characters, hyphens, and underscores'] },
      });
    }
  }

  /**
   * Creates the isolated volume and populates it with files.
   *
   * @param files - Map of filename to content (string or Buffer)
   * @returns The volume name for use in bind mounts
   *
   * @example
   * ```typescript
   * const volume = new IsolatedContainerVolume(tenantId, runId);
   * await volume.initialize({
   *   'domains.txt': domains.join('\n'),
   *   'config.json': JSON.stringify(config)
   * });
   * ```
   */
  async initialize(files: Record<string, string | Buffer>): Promise<string> {
    if (this.isInitialized) {
      throw new ConfigurationError('Volume already initialized', {
        details: { volumeName: this.volumeName, tenantId: this.tenantId, runId: this.runId },
      });
    }

    // Create unique volume name with timestamp to prevent collisions
    const timestamp = Date.now();
    this.volumeName = `tenant-${this.tenantId}-run-${this.runId}-${timestamp}`;

    try {
      // Create the volume with labels for tracking
      await this.executeDockerCommand('volume', 'create', [
        '--label', `studio.tenant=${this.tenantId}`,
        '--label', `studio.run=${this.runId}`,
        '--label', `studio.created=${new Date().toISOString()}`,
        '--label', 'studio.managed=true',
        this.volumeName,
      ]);

      // Populate files if provided
      if (Object.keys(files).length > 0) {
        await this.writeFiles(files);
      }

      this.isInitialized = true;
      return this.volumeName;
    } catch (error) {
      // Clean up on failure
      if (this.volumeName) {
        await this.cleanup().catch(() => {
          // Ignore cleanup errors during initialization failure
        });
      }
      throw new ContainerError(
        `Failed to initialize isolated volume: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          details: { tenantId: this.tenantId, runId: this.runId },
        },
      );
    }
  }

  /**
   * Validates filename to prevent path traversal and shell injection.
   *
   * @param filename - Filename to validate
   * @throws Error if filename is invalid
   */
  private validateFilename(filename: string): void {
    // Prevent path traversal
    if (filename.includes('..') || filename.startsWith('/')) {
      throw new ValidationError(`Invalid filename (path traversal): ${filename}`, {
        fieldErrors: { filename: ['path traversal not allowed'] },
        details: { filename },
      });
    }

    // Prevent shell metacharacters that could cause injection
    // Allow: alphanumeric, dots, hyphens, underscores, forward slashes (for subdirs)
    const safePattern = /^[a-zA-Z0-9._/-]+$/;
    if (!safePattern.test(filename)) {
      throw new ValidationError(
        `Invalid filename (contains unsafe characters): ${filename}. Only alphanumeric, dots, hyphens, underscores, and slashes allowed.`,
        {
          fieldErrors: { filename: ['contains unsafe characters'] },
          details: { filename, allowedPattern: safePattern.toString() },
        },
      );
    }

    // Additional check: no leading dots (hidden files) unless explicitly allowed
    const parts = filename.split('/');
    for (const part of parts) {
      if (part.startsWith('.') && part !== '.' && part !== '..') {
        throw new ValidationError(`Invalid filename (hidden file): ${filename}`, {
          fieldErrors: { filename: ['hidden files not allowed'] },
          details: { filename },
        });
      }
    }
  }

  /**
   * Writes files to the volume using a temporary Alpine container.
   *
   * @param files - Map of filename to content
   */
  private async writeFiles(files: Record<string, string | Buffer>): Promise<void> {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    for (const [filename, content] of Object.entries(files)) {
      // Strict validation to prevent path traversal and shell injection
      this.validateFilename(filename);

      const contentString = typeof content === 'string'
        ? content
        : content.toString('utf-8');

      // Use docker run with stdin to write the file
      await this.writeFileToVolume(filename, contentString);
    }
  }

  /**
   * Writes a single file to the volume using docker run with stdin.
   * Uses single-quote escaping to prevent shell injection.
   */
  private async writeFileToVolume(filename: string, content: string): Promise<void> {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    // Escape single quotes in filename to prevent shell injection
    // Replace ' with '\'' (close quote, escaped quote, open quote)
    const safeFilename = filename.replace(/'/g, "'\\''");

    return new Promise((resolve, reject) => {
      const proc = spawn('docker', [
        'run',
        '--rm',
        '-i', // Interactive to accept stdin
        '-v', `${this.volumeName}:/data`,
        '--entrypoint', 'sh',
        'alpine:latest',
        '-c', `cat > '/data/${safeFilename}'`,  // Single quotes prevent shell injection
      ]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to write file ${filename}: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to write file ${filename}: exit code ${code}, stderr: ${stderr}`));
        } else {
          resolve();
        }
      });

      // Write content to stdin and close
      proc.stdin.write(content);
      proc.stdin.end();
    });
  }

  /**
   * Reads files from the volume after container execution.
   *
   * @param filenames - Array of filenames to read
   * @returns Map of filename to content
   *
   * @example
   * ```typescript
   * const outputs = await volume.readFiles(['results.json', 'summary.txt']);
   * console.log(outputs['results.json']);
   * ```
   */
  async readFiles(filenames: string[]): Promise<Record<string, string>> {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    const results: Record<string, string> = {};

    for (const filename of filenames) {
      // Strict validation to prevent path traversal and injection
      this.validateFilename(filename);

      try {
        const content = await this.readFileFromVolume(filename);
        results[filename] = content;
      } catch (error) {
        // File might not exist, which is okay
        console.warn(`Could not read file ${filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return results;
  }

  /**
   * Reads a single file from the volume using docker run.
   * Uses cat entrypoint to avoid shell interpretation.
   */
  private async readFileFromVolume(filename: string): Promise<string> {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    // Note: Using cat as entrypoint (not sh), so filename is passed as argument
    // to cat directly, not interpreted by shell. No escaping needed here.
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', [
        'run',
        '--rm',
        '-v', `${this.volumeName}:/data:ro`,
        '--entrypoint', 'cat',
        'alpine:latest',
        `/data/${filename}`,  // Safe: passed to cat, not shell
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to read file ${filename}: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to read file ${filename}: exit code ${code}, stderr: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Returns the bind mount string for use in docker run commands.
   *
   * @param containerPath - Path inside the container where volume should be mounted
   * @param readOnly - Whether to mount as read-only (default: true for security)
   * @returns Bind mount string in format "volumeName:/path:mode"
   *
   * @example
   * ```typescript
   * const bindMount = volume.getBindMount('/inputs', true);
   * // Returns: "tenant-foo-run-bar-123456:/inputs:ro"
   * ```
   */
  getBindMount(containerPath: string = '/inputs', readOnly: boolean = true): string {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    const mode = readOnly ? 'ro' : 'rw';
    return `${this.volumeName}:${containerPath}:${mode}`;
  }

  /**
   * Gets the volume configuration for the component SDK runner format.
   *
   * @param containerPath - Path inside the container
   * @param readOnly - Whether to mount as read-only
   * @returns Volume configuration object
   */
  getVolumeConfig(containerPath: string = '/inputs', readOnly: boolean = true) {
    if (!this.volumeName) {
      throw new ConfigurationError('Volume not initialized', {
        details: { tenantId: this.tenantId, runId: this.runId },
      });
    }

    return {
      source: this.volumeName,
      target: containerPath,
      readOnly,
    };
  }

  /**
   * Cleans up the volume. Should be called in a finally block.
   *
   * @example
   * ```typescript
   * const volume = new IsolatedContainerVolume(tenantId, runId);
   * try {
   *   await volume.initialize({ 'input.txt': 'data' });
   *   // ... use volume ...
   * } finally {
   *   await volume.cleanup();
   * }
   * ```
   */
  async cleanup(): Promise<void> {
    if (!this.volumeName) {
      return; // Nothing to clean up
    }

    try {
      await this.executeDockerCommand('volume', 'rm', [this.volumeName]);
    } catch (error) {
      // Log but don't throw - cleanup should be best-effort
      console.error(
        `Failed to cleanup volume ${this.volumeName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isInitialized = false;
      this.volumeName = undefined;
    }
  }

  /**
   * Executes a docker command using spawn.
   */
  private async executeDockerCommand(
    subcommand: string,
    action: string,
    args: string[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', [subcommand, action, ...args]);

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Docker command failed: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Docker ${subcommand} ${action} failed with exit code ${code}: ${stderr}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Returns the volume name (useful for debugging/logging).
   */
  getVolumeName(): string | undefined {
    return this.volumeName;
  }
}

/**
 * Cleans up orphaned volumes created by this utility.
 * Should be run periodically as a maintenance task.
 *
 * @param olderThanHours - Remove volumes older than this many hours (default: 24)
 *
 * @example
 * ```typescript
 * // Clean up volumes older than 24 hours
 * await cleanupOrphanedVolumes(24);
 * ```
 */
export async function cleanupOrphanedVolumes(olderThanHours: number = 24): Promise<number> {
  try {
    const { stdout } = await exec(
      'docker volume ls --filter "label=studio.managed=true" --format "{{.Name}}|||{{.CreatedAt}}"',
    );

    if (!stdout.trim()) {
      return 0;
    }

    const lines = stdout.trim().split('\n');
    const cutoffTime = Date.now() - olderThanHours * 60 * 60 * 1000;
    let removedCount = 0;

    for (const line of lines) {
      const [volumeName, createdAt] = line.split('|||');

      if (!volumeName || !createdAt) continue;

      const createdTime = new Date(createdAt).getTime();

      if (createdTime < cutoffTime) {
        try {
          await exec(`docker volume rm ${volumeName}`);
          console.log(`Removed orphaned volume: ${volumeName}`);
          removedCount++;
        } catch (error) {
          console.error(`Failed to remove volume ${volumeName}: ${error}`);
        }
      }
    }

    return removedCount;
  } catch (error) {
    console.error(`Failed to cleanup orphaned volumes: ${error}`);
    return 0;
  }
}
