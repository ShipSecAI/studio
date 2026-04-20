import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { sanitizeForLogging, fetchInstallationToken } from './github-auth';

const LOG_PREFIX = '[GitHub Check Run]';

/**
 * Create Check Run Worker Component
 *
 * Creates a GitHub Check Run on a commit. Used for showing scan status and results
 * directly in the GitHub PR/commit UI.
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
  headSha: port(z.string(), {
    label: 'Head SHA',
    description: 'The SHA of the commit to create the check run on',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  name: port(z.string(), {
    label: 'Check Name',
    description: 'The name of the check (e.g., "Security Scan")',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  status: port(z.enum(['queued', 'in_progress', 'completed']), {
    label: 'Status',
    description: 'The current status of the check run',
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

export type CreateCheckRunInput = typeof inputSchema;

const outputSchema = outputs({
  checkRunId: port(z.number(), {
    label: 'Check Run ID',
    description: 'GitHub check run ID',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
});

export type CreateCheckRunOutput = typeof outputSchema;

const definition = defineComponent({
  id: 'github.check.create',
  label: 'Create Check Run',
  category: 'notification',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Create a GitHub Check Run to show scan status and results in the PR/commit UI.',
  ui: {
    slug: 'github-check-create',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: 'Create a GitHub Check Run to display scan status and results directly in GitHub.',
    icon: 'CheckCircle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Create a "Security Scan" check run with queued status',
      'Create a completed check run with findings summary',
    ],
  },
  async execute({ inputs }, context) {
    const { installationId, owner, repo, headSha, name, status, conclusion, output } = inputs;

    context.logger.info(
      `${LOG_PREFIX} Creating check run "${name}" for ${owner}/${repo}@${headSha.substring(0, 7)}`,
    );
    context.emitProgress({
      message: `Creating check run "${name}"...`,
      level: 'info',
      data: { owner, repo, headSha: headSha.substring(0, 7), name, stage: 'start' },
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
      message: 'Creating check run via GitHub API...',
      level: 'info',
      data: { owner, repo, name, status, stage: 'creating' },
    });

    // Build the request body
    const requestBody: Record<string, unknown> = {
      name,
      head_sha: headSha,
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

    // Create check run via GitHub API: POST /repos/{owner}/{repo}/check-runs
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/check-runs`;

    const response = await fetch(apiUrl, {
      method: 'POST',
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
        `${LOG_PREFIX} Failed to create check run: ${response.status} ${sanitizedError}`,
      );

      context.emitProgress({
        message: `Failed to create check run: ${response.status}`,
        level: 'error',
        data: { owner, repo, name, status: response.status, stage: 'error' },
      });

      throw new Error(`Failed to create check run: ${response.status} ${sanitizedError}`);
    }

    const result = (await response.json()) as { id: number };
    const checkRunId = result.id;

    context.logger.info(`${LOG_PREFIX} Created check run ${checkRunId} for ${owner}/${repo}`);

    context.emitProgress({
      message: `Check run created successfully`,
      level: 'info',
      data: { owner, repo, name, checkRunId, stage: 'complete' },
    });

    return outputSchema.parse({
      checkRunId,
    });
  },
});

componentRegistry.register(definition);
