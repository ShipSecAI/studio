import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { createIsolatedVolume } from '../../utils/isolated-volume';
import { sanitizeForLogging, fetchInstallationToken } from './github-auth';

/**
 * Clone Repository Worker Component
 *
 * Clones a GitHub repository to an isolated Docker volume for security scanning.
 * Supports both public repositories and private repositories via GitHub App installation tokens.
 */

const inputSchema = inputs({
  installationId: port(z.number().optional(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID for private repos. Leave empty for public repos.',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  repository: port(z.string().optional(), {
    label: 'Repository',
    description: 'Repository in owner/repo format. Overrides the parameter if connected.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  branch: port(z.string().optional(), {
    label: 'Branch',
    description: 'Branch to clone. Overrides the parameter if connected.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  ref: port(z.string().optional(), {
    label: 'Ref',
    description: 'Specific commit SHA. Overrides the parameter if connected.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  repository: param(
    z.string().trim().optional().describe('Repository to clone in owner/repo format'),
    {
      label: 'Repository',
      editor: 'text',
      description: 'Full repository name (e.g., owner/repo). Can also be provided via input port.',
      helpText: 'Enter the repository in owner/repo format',
    },
  ),
  branch: param(z.string().optional().describe('Branch to clone'), {
    label: 'Branch',
    editor: 'text',
    description: 'Branch name to clone (defaults to default branch)',
    helpText: 'Leave empty to clone the default branch',
  }),
  ref: param(z.string().optional().describe('Specific commit SHA or tag'), {
    label: 'Ref',
    editor: 'text',
    description: 'Specific commit SHA or tag to checkout',
    helpText: 'Use this for PR scans to checkout the exact commit',
  }),
  depth: param(
    z
      .number()
      .int()
      .min(0)
      .max(1000)
      .default(1)
      .describe('Clone depth (1 for shallow, 0 for full history)'),
    {
      label: 'Depth',
      editor: 'number',
      min: 0,
      max: 1000,
      description: 'Shallow clone depth (1 for latest commit only, 0 for full)',
    },
  ),
  submodules: param(z.boolean().default(false).describe('Clone submodules recursively'), {
    label: 'Include Submodules',
    editor: 'boolean',
    description: 'Whether to recursively clone submodules',
  }),
});

const outputSchema = outputs({
  volumePath: port(z.string(), {
    label: 'Volume Path',
    description: 'Path to the cloned repository in the isolated volume',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  repository: port(z.string(), {
    label: 'Repository',
    description: 'Full repository name that was cloned',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  branch: port(z.string(), {
    label: 'Branch',
    description: 'Branch that was cloned',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  commitSha: port(z.string(), {
    label: 'Commit SHA',
    description: 'The commit SHA that was checked out',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  cloneUrl: port(z.string(), {
    label: 'Clone URL',
    description: 'The public URL of the repository (without token)',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  installationId: port(z.number().optional(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID used for authentication (if resolved)',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description:
      'Docker volume name containing the cloned repository. Connect this to downstream scanners. Volumes are automatically cleaned up when the workflow finishes.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

type Output = z.infer<typeof outputSchema>;

// Runner output schema for parsing git command results
const runnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

/**
 * Validate a git ref (branch name, tag, or commit SHA) to prevent shell injection.
 * Allows only characters valid in git refs: alphanumeric, forward slash, dash,
 * underscore, dot, and @. Rejects shell metacharacters and traversal patterns.
 */
function validateGitRef(value: string, fieldName: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.@-]*$/.test(value)) {
    throw new ContainerError(`Invalid ${fieldName}: contains disallowed characters`, {
      details: { reason: 'invalid_git_ref', [fieldName]: value.slice(0, 100) },
    });
  }
  if (value.includes('..') || value.includes('@{')) {
    throw new ContainerError(`Invalid ${fieldName}: contains disallowed sequence`, {
      details: { reason: 'invalid_git_ref', [fieldName]: value.slice(0, 100) },
    });
  }
}

// Retry policy - git clones can fail due to network issues
const cloneRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'github.repo.clone',
  label: 'Clone GitHub Repository',
  category: 'security',
  retryPolicy: cloneRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'alpine/git:latest',
    entrypoint: 'sh',
    network: 'bridge', // Need network for git clone
    timeoutSeconds: 300, // 5 minutes for large repos
    command: ['-c'],
    env: {
      HOME: '/tmp',
      GIT_TERMINAL_PROMPT: '0', // Disable interactive prompts
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Clone a GitHub repository to an isolated Docker volume for security scanning. Supports both public and private repos via GitHub App installation.',
  ui: {
    slug: 'github-clone-repo',
    version: '1.0.0',
    type: 'input',
    category: 'security',
    description: 'Clone a GitHub repository to an isolated Docker volume for security scanning.',
    documentation:
      'Clones a repository with configurable depth, branch, and submodule options. For private repos, provide the GitHub App installation ID to authenticate. The cloned code is stored at /repo inside the Docker volume. Downstream components should mount the volume and access the repository at {mountTarget}/repo.',
    icon: 'GitBranch',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'Clone owner/repo to scan with TruffleHog, OpenGrep, or other scanners.',
    examples: [
      'Clone a repository before running TruffleHog for secret scanning',
      'Clone a PR branch for SAST analysis with OpenGrep',
      'Clone with depth=0 for full git history scanning',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    // Input ports override parameters (allows wiring from triggers or other components)
    const repository = parsedInputs.repository || parsedParams.repository;
    const branch = parsedInputs.branch || parsedParams.branch;
    const ref = parsedInputs.ref || parsedParams.ref;
    const { depth, submodules } = parsedParams;
    const { installationId } = parsedInputs;

    if (!repository) {
      throw new ContainerError('Repository is required: provide it via input port or parameter');
    }

    // Validate branch/ref to prevent shell injection (defense-in-depth:
    // values are also passed via env vars, but reject clearly invalid refs early)
    if (branch) {
      validateGitRef(branch, 'branch');
    }
    if (ref) {
      validateGitRef(ref, 'ref');
    }

    context.logger.info(`[GitHub Clone] Starting clone of ${repository}`);

    context.emitProgress({
      message: `Preparing to clone ${repository}...`,
      level: 'info',
      data: { repository, branch: branch || 'default', stage: 'init' },
    });

    // Get tenant ID for isolated volume
    const tenantId = (context as any).tenantId ?? context.runId;
    let volume: ReturnType<typeof createIsolatedVolume> | null = null;

    try {
      // Create isolated volume for the clone
      context.emitProgress({
        message: 'Creating isolated workspace...',
        level: 'info',
        data: { repository, stage: 'volume' },
      });

      volume = createIsolatedVolume(tenantId, context.runId);
      await volume.initialize({});

      context.logger.info(`[GitHub Clone] Created isolated volume: ${volume.getVolumeName()}`);

      // Determine clone URL - for private repos, we need the token
      const publicCloneUrl = `https://github.com/${repository}.git`;
      let gitCloneUrl = publicCloneUrl;
      let isAuthenticated = false;
      const resolvedInstallationId = installationId;

      context.emitProgress({
        message: 'Authenticating with GitHub...',
        level: 'info',
        data: { repository, stage: 'auth' },
      });

      let token: string | null = null;

      if (installationId) {
        context.logger.info(`[GitHub Clone] Fetching installation token for ID: ${installationId}`);
        token = await fetchInstallationToken(installationId, context, '[GitHub Clone]');
      } else {
        context.logger.info(`[GitHub Clone] No installationId provided, attempting public clone`);
      }

      if (token) {
        gitCloneUrl = `https://x-access-token:${token}@github.com/${repository}.git`;
        isAuthenticated = true;
        context.logger.info('[GitHub Clone] Successfully authenticated with GitHub App');

        context.emitProgress({
          message: 'Authenticated with GitHub App',
          level: 'info',
          data: { repository, authenticated: true, stage: 'auth' },
        });
      } else {
        context.logger.warn(
          '[GitHub Clone] Could not obtain installation token, attempting clone without authentication',
        );

        context.emitProgress({
          message: 'Warning: Proceeding without authentication (public repos only)',
          level: 'warn',
          data: { repository, authenticated: false, stage: 'auth' },
        });
      }

      // Emit progress for clone start
      context.emitProgress({
        message: `Cloning ${repository}${branch ? ` (branch: ${branch})` : ''}...`,
        level: 'info',
        data: { repository, branch: branch || 'default', stage: 'clone' },
      });

      // Build the git clone command.
      // SECURITY: Branch, ref, and URL are passed via environment variables
      // (double-quoted in the shell) to prevent shell injection.
      const cloneArgs: string[] = ['git', 'clone'];

      if (depth > 0) {
        cloneArgs.push('--depth', String(depth));
      }

      if (branch) {
        cloneArgs.push('--branch', '"$GIT_BRANCH"');
      }

      if (submodules) {
        cloneArgs.push('--recurse-submodules');
      }

      // URL is passed via environment variable to avoid logging tokens
      cloneArgs.push('"$CLONE_URL"', '/workspace/repo');

      // Mark the mounted repository as safe before any follow-up git commands.
      // K8s GCS Fuse mounts can present ownership metadata that triggers Git's
      // dubious ownership protection inside the pod.
      const markRepoSafe = 'git config --global --add safe.directory /workspace/repo';

      // Add post-clone commands to get commit info
      const postCloneCommands = [
        markRepoSafe,
        // If ref is specified, checkout that ref (value via env var)
        ref ? 'cd /workspace/repo && git checkout "$GIT_REF"' : '',
        // Get the commit SHA
        'cd /workspace/repo && git rev-parse HEAD > /workspace/commit_sha.txt',
        // Get the branch name
        'cd /workspace/repo && git rev-parse --abbrev-ref HEAD > /workspace/branch.txt',
      ]
        .filter(Boolean)
        .join(' && ');

      const fullCommand = `${cloneArgs.join(' ')} && ${postCloneCommands}`;

      // Log command without URL (URL would expose token)
      context.logger.info(
        `[GitHub Clone] Executing: git clone ${depth > 0 ? `--depth ${depth} ` : ''}${branch ? `--branch ${branch} ` : ''}${submodules ? '--recurse-submodules ' : ''}<repo-url> /workspace/repo`,
      );

      // Configure runner
      const baseRunner = definition.runner;
      if (baseRunner.kind !== 'docker') {
        throw new ContainerError('Clone runner must be docker', {
          details: {
            reason: 'runner_type_mismatch',
            expected: 'docker',
            actual: baseRunner.kind,
          },
        });
      }

      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: ['-c', fullCommand],
        env: {
          ...baseRunner.env,
          // CRITICAL: Pass untrusted values via env vars to prevent shell injection
          // and to prevent tokens from appearing in logs.
          CLONE_URL: gitCloneUrl,
          ...(branch ? { GIT_BRANCH: branch } : {}),
          ...(ref ? { GIT_REF: ref } : {}),
        },
        volumes: [volume.getVolumeConfig('/workspace', false)], // Read-write for clone
      };

      // Execute the clone
      const rawResult = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...parsedInputs, ...parsedParams },
        context,
      );

      // Parse result
      const parsedResult = runnerOutputSchema.safeParse(rawResult);
      let exitCode = 0;
      let stderr = '';

      if (parsedResult.success) {
        exitCode = parsedResult.data.exitCode ?? 0;
        stderr = parsedResult.data.stderr ?? '';
      }

      if (exitCode !== 0) {
        // CRITICAL: Sanitize error message to remove any tokens before logging/throwing
        const sanitizedError = sanitizeForLogging(stderr).slice(0, 500);

        context.emitProgress({
          message: `Clone failed: ${sanitizedError}`,
          level: 'error',
          data: { repository, exitCode, stage: 'error' },
        });

        throw new ContainerError(`Git clone failed: ${sanitizedError}`, {
          details: { exitCode, repository },
        });
      }

      // Emit progress for post-clone processing
      context.emitProgress({
        message: 'Clone complete, extracting commit information...',
        level: 'info',
        data: { repository, stage: 'post-clone' },
      });

      // Read commit info from the volume
      const files = await volume.readFiles(['commit_sha.txt', 'branch.txt']);

      const commitSha = files['commit_sha.txt']?.trim() || 'unknown';
      const actualBranch = files['branch.txt']?.trim() || branch || 'HEAD';

      context.logger.info(
        `[GitHub Clone] Successfully cloned ${repository} at ${commitSha.substring(0, 7)}`,
      );

      context.emitProgress({
        message: `✓ Clone complete: ${repository} @ ${commitSha.substring(0, 7)}`,
        level: 'info',
        data: {
          repository,
          branch: actualBranch,
          commitSha,
          authenticated: isAuthenticated,
          stage: 'complete',
        },
      });

      // Note: We don't cleanup the volume here because downstream components need it
      // The workflow engine handles cleanup after the workflow completes

      // Contribute context for downstream components
      context.contributeRunContext?.('repository', repository);
      context.contributeRunContext?.('branch', actualBranch);
      context.contributeRunContext?.('commitSha', commitSha);

      const output: Output = {
        volumePath: '/workspace/repo',
        repository,
        branch: actualBranch,
        commitSha,
        cloneUrl: publicCloneUrl, // CRITICAL: Return public URL without token
        installationId: resolvedInstallationId,
        volumeName: volume!.getVolumeName()!,
      };

      return outputSchema.parse(output);
    } catch (error) {
      // Clean up volume on error
      if (volume) {
        await volume.cleanup().catch((cleanupErr) => {
          context.logger.warn(
            `[GitHub Clone] Failed to cleanup volume: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          );
        });
      }

      if (error instanceof ContainerError) {
        throw error;
      }

      // CRITICAL: Sanitize any error messages before throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedMessage = sanitizeForLogging(errorMessage);

      throw new ContainerError(`Clone failed: ${sanitizedMessage}`, {
        cause: error instanceof Error ? error : undefined,
        details: { repository },
      });
    }
  },
});

componentRegistry.register(definition);

export type CloneRepoInput = typeof inputSchema;
export type CloneRepoOutput = typeof outputSchema;
