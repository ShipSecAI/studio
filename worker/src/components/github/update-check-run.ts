import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { sanitizeForLogging, fetchInstallationToken } from './github-auth';

const LOG_PREFIX = '[GitHub Check Run]';

/**
 * Update Check Run Worker Component
 *
 * Updates an existing GitHub Check Run. Used for updating scan status and results
 * as scanning progresses or completes.
 */

// Check run output schema for the optional output field
const checkRunOutputSchema = z
  .object({
    title: z.string().describe('Title of the check run output'),
    summary: z.string().describe('Summary of the check run (supports markdown)'),
    text: z.string().optional().describe('Detailed text (supports markdown)'),
  })
  .optional();

const inputSchema = inputs({
  installationId: port(z.number().optional(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID. If not provided, auto-resolved from owner/repo.',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  owner: port(z.string(), {
    label: 'Owner',
    description: 'Repository owner (org or user)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  repo: port(z.string(), {
    label: 'Repository',
    description: 'Repository name',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  checkRunId: port(z.number(), {
    label: 'Check Run ID',
    description: 'The ID of the check run to update',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  status: port(z.enum(['queued', 'in_progress', 'completed']), {
    label: 'Status',
    description: 'The new status of the check run',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  conclusion: port(z.enum(['success', 'failure', 'neutral', 'cancelled', 'skipped']).optional(), {
    label: 'Conclusion',
    description: 'The final conclusion of the check run (required when status is completed)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  output: port(checkRunOutputSchema, {
    label: 'Output',
    description: 'Optional structured output with title, summary, and text',
    connectionType: { kind: 'any' },
  }),
});

export type UpdateCheckRunInput = typeof inputSchema;

const outputSchema = outputs({
  checkRunId: port(z.number(), {
    label: 'Check Run ID',
    description: 'GitHub check run ID',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
});

export type UpdateCheckRunOutput = typeof outputSchema;

const definition = defineComponent({
  id: 'github.check.update',
  label: 'Update Check Run',
  category: 'notification',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Update an existing GitHub Check Run to update scan status and results in the PR/commit UI.',
  ui: {
    slug: 'github-check-update',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description:
      'Update an existing GitHub Check Run to update scan status and results directly in GitHub.',
    icon: 'RefreshCw',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Update a check run to "in_progress" status',
      'Complete a check run with success conclusion and findings summary',
    ],
  },
  async execute({ inputs }, context) {
    const { installationId, owner, repo, checkRunId, status, conclusion, output } = inputs;

    context.logger.info(`${LOG_PREFIX} Updating check run ${checkRunId} for ${owner}/${repo}`);
    context.emitProgress({
      message: `Updating check run ${checkRunId}...`,
      level: 'info',
      data: { owner, repo, checkRunId, status, stage: 'start' },
    });

    // Resolve installation token
    if (!installationId) {
      throw new Error(
        `Installation ID is required for ${owner}/${repo}. ` +
          'Ensure the GitHub App installation ID is provided via workflow inputs.',
      );
    }

    const token = await fetchInstallationToken(installationId, context, LOG_PREFIX);

    if (!token) {
      throw new Error(
        `Failed to obtain installation token for ${owner}/${repo}. ` +
          'Ensure the GitHub App is installed and has access to the repository.',
      );
    }

    context.emitProgress({
      message: 'Updating check run via GitHub API...',
      level: 'info',
      data: { owner, repo, checkRunId, status, stage: 'updating' },
    });

    // Build the request body
    const requestBody: Record<string, unknown> = {
      status,
    };

    // Add conclusion if status is completed
    if (status === 'completed') {
      if (!conclusion) {
        throw new Error(
          'Conclusion is required when status is "completed". ' +
            'Valid values: success, failure, neutral, cancelled, skipped',
        );
      }
      requestBody.conclusion = conclusion;
    }

    // Add optional output
    if (output) {
      requestBody.output = output;
    }

    // Update check run via GitHub API: PATCH /repos/{owner}/{repo}/check-runs/{checkRunId}
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`;

    const response = await fetch(apiUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const sanitizedError = sanitizeForLogging(errorText);
      context.logger.error(
        `${LOG_PREFIX} Failed to update check run: ${response.status} ${sanitizedError}`,
      );

      context.emitProgress({
        message: `Failed to update check run: ${response.status}`,
        level: 'error',
        data: { owner, repo, checkRunId, status: response.status, stage: 'error' },
      });

      throw new Error(`Failed to update check run: ${response.status} ${sanitizedError}`);
    }

    const result = (await response.json()) as { id: number };

    context.logger.info(`${LOG_PREFIX} Updated check run ${checkRunId} for ${owner}/${repo}`);

    context.emitProgress({
      message: `Check run updated successfully`,
      level: 'info',
      data: { owner, repo, checkRunId, status, stage: 'complete' },
    });

    return outputSchema.parse({
      checkRunId: result.id,
    });
  },
});

componentRegistry.register(definition);
