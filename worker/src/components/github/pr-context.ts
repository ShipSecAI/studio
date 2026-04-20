import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { sanitizeForLogging, fetchInstallationToken } from './github-auth';

const LOG_PREFIX = '[GitHub PR Context]';

/**
 * PR Context Worker Component
 *
 * Fetches metadata and changed files for a GitHub pull request.
 * This information is used to:
 * - Filter scan findings to only files changed in the PR
 * - Build targeted scan configurations
 * - Include PR metadata in comments/reports
 */

// Schema for file change information
const changedFileSchema = z.object({
  filename: z.string().describe('Path to the file'),
  status: z
    .enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'])
    .describe('Type of change'),
  additions: z.number().describe('Lines added'),
  deletions: z.number().describe('Lines deleted'),
  changes: z.number().describe('Total lines changed'),
  patch: z.string().optional().describe('Unified diff patch'),
});

const inputSchema = inputs({
  installationId: port(z.number(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID for authentication',
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
  pullNumber: port(z.number(), {
    label: 'Pull Request Number',
    description: 'The pull request number to fetch context for',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
});

export type PrContextInput = typeof inputSchema;

const outputSchema = outputs({
  // PR Metadata
  title: port(z.string(), {
    label: 'PR Title',
    description: 'Title of the pull request',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  author: port(z.string(), {
    label: 'Author',
    description: 'GitHub username of the PR author',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  baseBranch: port(z.string(), {
    label: 'Base Branch',
    description: 'Target branch the PR will merge into',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  headBranch: port(z.string(), {
    label: 'Head Branch',
    description: 'Source branch with the changes',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  headSha: port(z.string(), {
    label: 'Head SHA',
    description: 'Commit SHA of the head branch (for cloning/checking)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  baseSha: port(z.string(), {
    label: 'Base SHA',
    description: 'Commit SHA of the base branch',
    connectionType: { kind: 'primitive', name: 'text' },
  }),

  // Changed files
  changedFiles: port(z.array(z.string()), {
    label: 'Changed Files',
    description: 'List of file paths that were changed in this PR',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  changedFilesDetailed: port(z.array(changedFileSchema), {
    label: 'Changed Files (Detailed)',
    description: 'Detailed information about each changed file including additions/deletions',
    connectionType: { kind: 'any' },
  }),

  // Stats
  additions: port(z.number(), {
    label: 'Total Additions',
    description: 'Total lines added across all files',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  deletions: port(z.number(), {
    label: 'Total Deletions',
    description: 'Total lines deleted across all files',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  changedFileCount: port(z.number(), {
    label: 'Changed File Count',
    description: 'Number of files changed in the PR',
    connectionType: { kind: 'primitive', name: 'number' },
  }),

  // Clone info
  cloneUrl: port(z.string(), {
    label: 'Clone URL',
    description: 'HTTPS clone URL for the repository (public, no token)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),

  // PR state
  state: port(z.string(), {
    label: 'PR State',
    description: 'Current state of the PR (open, closed, merged)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  isDraft: port(z.boolean(), {
    label: 'Is Draft',
    description: 'Whether the PR is a draft',
    connectionType: { kind: 'primitive', name: 'boolean' },
  }),
  labels: port(z.array(z.string()), {
    label: 'Labels',
    description: 'Labels applied to the PR',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
});

export type PrContextOutput = typeof outputSchema;

// GitHub API response types
interface GitHubPrResponse {
  title: string;
  user: { login: string };
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  state: string;
  draft: boolean;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: { name: string }[];
  html_url: string;
}

interface GitHubFileResponse {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

const definition = defineComponent({
  id: 'github.pr.context',
  label: 'Get PR Context',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Fetch PR metadata and changed files. Use to filter scan results to only changed files.',
  ui: {
    slug: 'github-pr-context',
    version: '1.0.0',
    type: 'input',
    category: 'security',
    description: 'Fetches pull request metadata, changed files, and refs for targeted scanning.',
    documentation:
      'Use this component to get PR context before running security scans. The changedFiles output can be used to filter scan results to only show findings in files that were changed in the PR.',
    icon: 'GitPullRequest',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'Get PR #123 context, then pass changedFiles to filter TruffleHog results',
    examples: [
      'Filter OpenGrep findings to only changed files',
      'Get headSha for cloning the exact PR commit',
      'Check if PR is draft before running expensive scans',
    ],
  },
  async execute({ inputs }, context) {
    const { installationId, owner, repo, pullNumber } = inputSchema.parse(inputs);

    context.logger.info(`${LOG_PREFIX} Fetching context for ${owner}/${repo}#${pullNumber}`);

    context.emitProgress({
      message: `Fetching PR #${pullNumber} context...`,
      level: 'info',
      data: { owner, repo, pullNumber, stage: 'start' },
    });

    // Get installation token
    const token = await fetchInstallationToken(installationId, context, LOG_PREFIX);
    if (!token) {
      throw new Error(
        `Failed to obtain installation token for ${owner}/${repo}. ` +
          'Ensure the GitHub App is installed and has access.',
      );
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Fetch PR metadata
    context.emitProgress({
      message: 'Fetching PR metadata...',
      level: 'info',
      data: { owner, repo, pullNumber, stage: 'metadata' },
    });

    const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`;
    const prResponse = await fetch(prUrl, { headers });

    if (!prResponse.ok) {
      const errorText = await prResponse.text();
      const sanitizedError = sanitizeForLogging(errorText);
      throw new Error(`Failed to fetch PR metadata: ${prResponse.status} ${sanitizedError}`);
    }

    const prData = (await prResponse.json()) as GitHubPrResponse;

    // Fetch changed files (paginated - up to 3000 files)
    context.emitProgress({
      message: 'Fetching changed files...',
      level: 'info',
      data: { owner, repo, pullNumber, stage: 'files' },
    });

    const allFiles: GitHubFileResponse[] = [];
    let page = 1;
    const perPage = 100; // GitHub max per page

    while (allFiles.length < prData.changed_files && page <= 30) {
      const filesUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`;
      const filesResponse = await fetch(filesUrl, { headers });

      if (!filesResponse.ok) {
        context.logger.warn(
          `${LOG_PREFIX} Failed to fetch files page ${page}: ${filesResponse.status}`,
        );
        break;
      }

      const pageFiles = (await filesResponse.json()) as GitHubFileResponse[];
      if (pageFiles.length === 0) break;

      allFiles.push(...pageFiles);
      page++;
    }

    context.logger.info(
      `${LOG_PREFIX} Fetched ${allFiles.length} changed files for PR #${pullNumber}`,
    );

    // Build outputs
    const changedFiles = allFiles.map((f) => f.filename);
    const changedFilesDetailed = allFiles.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));

    context.emitProgress({
      message: `✓ PR context fetched: ${allFiles.length} files changed`,
      level: 'info',
      data: {
        owner,
        repo,
        pullNumber,
        changedFileCount: allFiles.length,
        additions: prData.additions,
        deletions: prData.deletions,
        stage: 'complete',
      },
    });

    return outputSchema.parse({
      // PR Metadata
      title: prData.title,
      author: prData.user.login,
      baseBranch: prData.base.ref,
      headBranch: prData.head.ref,
      headSha: prData.head.sha,
      baseSha: prData.base.sha,

      // Changed files
      changedFiles,
      changedFilesDetailed,

      // Stats
      additions: prData.additions,
      deletions: prData.deletions,
      changedFileCount: allFiles.length,

      // Clone info
      cloneUrl: `https://github.com/${owner}/${repo}.git`,

      // PR state
      state: prData.state,
      isDraft: prData.draft,
      labels: prData.labels.map((l) => l.name),
    });
  },
});

componentRegistry.register(definition);
