import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { sanitizeForLogging, fetchInstallationToken } from './github-auth';

const LOG_PREFIX = '[GitHub PR Comment]';

/**
 * Post PR Comment Worker Component
 *
 * Posts or updates scan results as a comment on a GitHub pull request.
 * Supports upsert: if existingCommentId is provided, attempts PATCH first,
 * falling back to POST if the comment no longer exists (404/410).
 */

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
  prNumber: port(z.number(), {
    label: 'PR Number',
    description: 'Pull request number to comment on',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  body: port(z.string(), {
    label: 'Comment Body',
    description: 'Markdown content for the PR comment',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  existingCommentId: port(z.number().optional(), {
    label: 'Existing Comment ID',
    description: 'If provided, updates an existing comment instead of creating a new one.',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
});

export type PostPrCommentInput = typeof inputSchema;

const outputSchema = outputs({
  commentId: port(z.number(), {
    label: 'Comment ID',
    description: 'GitHub comment ID',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  commentUrl: port(z.string(), {
    label: 'Comment URL',
    description: 'Direct URL to the comment',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

export type PostPrCommentOutput = typeof outputSchema;

const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const definition = defineComponent({
  id: 'github.pr.comment',
  label: 'Post PR Comment',
  category: 'notification',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Post scan results as a comment on a GitHub pull request.',
  ui: {
    slug: 'github-pr-comment',
    version: '1.0.0',
    type: 'output',
    category: 'notification',
    description: 'Post content as a comment on a GitHub pull request.',
    icon: 'MessageSquare',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Post TruffleHog secret scan results to PR',
      'Post OpenGrep SAST findings summary to PR',
    ],
  },
  async execute({ inputs }, context) {
    const { installationId, owner, repo, prNumber, body, existingCommentId } = inputs;

    context.logger.info(`${LOG_PREFIX} Posting comment to ${owner}/${repo}#${prNumber}`);
    context.emitProgress({
      message: `Posting comment to PR #${prNumber}...`,
      level: 'info',
      data: { owner, repo, prNumber, stage: 'start' },
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

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      ...GITHUB_API_HEADERS,
    };

    let commentId: number;
    let commentUrl: string;

    // Try PATCH if we have an existing comment ID (upsert mode)
    if (existingCommentId) {
      context.emitProgress({
        message: 'Updating existing PR comment...',
        level: 'info',
        data: { owner, repo, prNumber, existingCommentId, stage: 'updating' },
      });

      const patchUrl = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingCommentId}`;
      const patchResponse = await fetch(patchUrl, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ body }),
      });

      if (patchResponse.ok) {
        const patchResult = (await patchResponse.json()) as { id: number; html_url: string };
        commentId = patchResult.id;
        commentUrl = patchResult.html_url;

        context.logger.info(`${LOG_PREFIX} Updated comment ${commentId} at ${commentUrl}`);
        context.emitProgress({
          message: 'Comment updated successfully',
          level: 'info',
          data: { owner, repo, prNumber, commentId, commentUrl, stage: 'complete' },
        });

        return outputSchema.parse({ commentId, commentUrl });
      }

      // Fallback to POST if comment was deleted (404/410)
      if (patchResponse.status === 404 || patchResponse.status === 410) {
        context.logger.warn(
          `${LOG_PREFIX} Existing comment ${existingCommentId} not found (${patchResponse.status}), falling back to POST`,
        );
      } else {
        // Non-retryable PATCH failure — still fall back to POST
        const errorText = await patchResponse.text();
        const sanitizedError = sanitizeForLogging(errorText);
        context.logger.warn(
          `${LOG_PREFIX} PATCH failed (${patchResponse.status}), falling back to POST: ${sanitizedError}`,
        );
      }
    }

    // POST a new comment
    context.emitProgress({
      message: 'Creating PR comment...',
      level: 'info',
      data: { owner, repo, prNumber, stage: 'creating' },
    });

    const postUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
    const postResponse = await fetch(postUrl, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ body }),
    });

    if (!postResponse.ok) {
      const errorText = await postResponse.text();
      const sanitizedError = sanitizeForLogging(errorText);
      context.logger.error(
        `${LOG_PREFIX} Failed to create comment: ${postResponse.status} ${sanitizedError}`,
      );

      context.emitProgress({
        message: `Failed to create comment: ${postResponse.status}`,
        level: 'error',
        data: { owner, repo, prNumber, status: postResponse.status, stage: 'error' },
      });

      throw new Error(`Failed to create PR comment: ${postResponse.status} ${sanitizedError}`);
    }

    const result = (await postResponse.json()) as { id: number; html_url: string };
    commentId = result.id;
    commentUrl = result.html_url;

    context.logger.info(`${LOG_PREFIX} Created comment ${commentId} at ${commentUrl}`);

    context.emitProgress({
      message: `Comment posted successfully`,
      level: 'info',
      data: { owner, repo, prNumber, commentId, commentUrl, stage: 'complete' },
    });

    return outputSchema.parse({
      commentId,
      commentUrl,
    });
  },
});

componentRegistry.register(definition);
