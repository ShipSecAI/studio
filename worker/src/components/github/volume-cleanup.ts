import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const LOG_PREFIX = '[Volume Cleanup]';

/**
 * Volume Cleanup Worker Component
 *
 * Cleans up Docker volumes created by the github.repo.clone component.
 * Should be placed at the end of workflows after all scanners have completed.
 *
 * This component ensures that cloned repositories don't accumulate on disk,
 * preventing storage leaks in long-running deployments.
 */

const inputSchema = inputs({
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description: 'Docker volume name to cleanup (from github.repo.clone component)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

export type VolumeCleanupInput = typeof inputSchema;

const outputSchema = outputs({
  deleted: port(z.boolean(), {
    label: 'Deleted',
    description: 'Whether the volume was successfully deleted',
    connectionType: { kind: 'primitive', name: 'boolean' },
  }),
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description: 'The volume name that was deleted',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  message: port(z.string(), {
    label: 'Message',
    description: 'Status message describing the cleanup result',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

export type VolumeCleanupOutput = typeof outputSchema;

const definition = defineComponent({
  id: 'github.repo.volume.cleanup',
  label: 'Cleanup Repository Volume',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Cleans up Docker volumes created by the github.repo.clone component. Place at the end of scan workflows to prevent disk leaks.',
  ui: {
    slug: 'github-volume-cleanup',
    version: '1.0.0',
    type: 'output',
    category: 'security',
    description: 'Remove Docker volumes after security scanning is complete to free disk space.',
    documentation:
      'This component should be placed at the end of workflows that use github.repo.clone. It removes the temporary Docker volume containing the cloned repository. Safe to call even if the volume was already deleted.',
    icon: 'Trash2',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Connect volumeName from github.repo.clone to cleanup the cloned repository after scanning.',
    examples: [
      'Clean up after TruffleHog secret scanning',
      'Remove cloned repo after OpenGrep SAST analysis',
      'Free disk space in long-running scan workflows',
    ],
  },
  async execute({ inputs }, context) {
    const { volumeName } = inputSchema.parse(inputs);

    context.logger.info(`${LOG_PREFIX} Starting cleanup of volume: ${volumeName}`);

    context.emitProgress({
      message: `Cleaning up volume ${volumeName}...`,
      level: 'info',
      data: { volumeName, stage: 'start' },
    });

    // Validate volume name format to prevent command injection
    // Volume names follow pattern: tenant-{tenantId}-run-{runId}-{timestamp}
    // Only allow alphanumeric, hyphens, and underscores
    const volumeNamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!volumeNamePattern.test(volumeName)) {
      context.logger.error(`${LOG_PREFIX} Invalid volume name format: ${volumeName}`);

      context.emitProgress({
        message: 'Invalid volume name format',
        level: 'error',
        data: { volumeName, stage: 'error' },
      });

      return outputSchema.parse({
        deleted: false,
        volumeName,
        message: `Invalid volume name format: ${volumeName}`,
      });
    }

    try {
      // Check if volume exists first
      const { stdout: inspectStdout } = await execAsync(
        `docker volume inspect ${volumeName} 2>/dev/null || echo "NOT_FOUND"`,
      );

      if (inspectStdout.includes('NOT_FOUND')) {
        context.logger.info(`${LOG_PREFIX} Volume ${volumeName} does not exist, skipping cleanup`);

        context.emitProgress({
          message: `Volume ${volumeName} already cleaned up`,
          level: 'info',
          data: { volumeName, existed: false, stage: 'complete' },
        });

        return outputSchema.parse({
          deleted: false,
          volumeName,
          message: `Volume ${volumeName} does not exist (already cleaned up)`,
        });
      }

      // Remove the volume
      context.logger.info(`${LOG_PREFIX} Removing volume: ${volumeName}`);

      await execAsync(`docker volume rm ${volumeName}`);

      context.logger.info(`${LOG_PREFIX} Successfully removed volume: ${volumeName}`);

      context.emitProgress({
        message: `✓ Volume ${volumeName} cleaned up successfully`,
        level: 'info',
        data: { volumeName, deleted: true, stage: 'complete' },
      });

      return outputSchema.parse({
        deleted: true,
        volumeName,
        message: `Volume ${volumeName} successfully removed`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if error is because volume is in use
      if (errorMessage.includes('volume is in use')) {
        context.logger.warn(`${LOG_PREFIX} Volume ${volumeName} is still in use, cannot remove`);

        context.emitProgress({
          message: `Volume ${volumeName} is still in use`,
          level: 'warn',
          data: { volumeName, inUse: true, stage: 'error' },
        });

        return outputSchema.parse({
          deleted: false,
          volumeName,
          message: `Volume ${volumeName} is still in use by a container`,
        });
      }

      context.logger.error(`${LOG_PREFIX} Failed to remove volume ${volumeName}: ${errorMessage}`);

      context.emitProgress({
        message: `Failed to cleanup volume: ${errorMessage}`,
        level: 'error',
        data: { volumeName, error: errorMessage, stage: 'error' },
      });

      // Don't throw - cleanup failures shouldn't fail the workflow
      return outputSchema.parse({
        deleted: false,
        volumeName,
        message: `Failed to remove volume: ${errorMessage}`,
      });
    }
  },
});

componentRegistry.register(definition);
