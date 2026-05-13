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
import { fetchInstallationToken, sanitizeForLogging } from './github-auth';

const repositoryNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Repository must be owner/repo');

const inputSchema = inputs({
  installationId: port(z.number().optional(), {
    label: 'Installation ID',
    description: 'GitHub App installation ID for private repos.',
    connectionType: { kind: 'primitive', name: 'number' },
  }),
  repositories: port(z.array(repositoryNameSchema).min(1), {
    label: 'Repositories',
    description: 'Repositories in owner/repo format.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  branch: port(z.string().optional(), {
    label: 'Branch',
    description: 'Branch to clone for every repository.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  depth: param(z.number().int().min(0).max(1000).default(1), {
    label: 'Depth',
    editor: 'number',
    description: 'Shallow clone depth.',
  }),
});

const outputSchema = outputs({
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description: 'Docker volume containing all cloned repositories under /repos.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  repositories: port(z.array(z.string()), {
    label: 'Repositories',
    description: 'Repositories that were cloned.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  repository: port(z.string(), {
    label: 'Repository Set',
    description: 'Comma-separated repository set label.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  branch: port(z.string(), {
    label: 'Branch',
    description: 'Branch cloned.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  commitMap: port(z.record(z.string(), z.string()), {
    label: 'Commit Map',
    description: 'Repository to commit SHA.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const runnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const cloneRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 20,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

function validateGitRef(value: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_.@-]*$/.test(value) ||
    value.includes('..') ||
    value.includes('@{')
  ) {
    throw new ContainerError('Invalid branch: contains disallowed characters');
  }
}

function repoDir(repository: string): string {
  return repository.toLowerCase().replace(/[^a-z0-9_.-]+/g, '__');
}

const definition = defineComponent({
  id: 'github.repos.clone-many',
  label: 'Clone GitHub Repositories',
  category: 'security',
  retryPolicy: cloneRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'alpine/git:latest',
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: 600,
    command: ['-c'],
    env: { HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Clone multiple GitHub repositories into one isolated Docker volume for cross-repo agent review.',
  ui: {
    slug: 'github-clone-many-repos',
    version: '1.0.0',
    type: 'input',
    category: 'security',
    description: 'Clone several repositories into a shared workspace.',
    icon: 'GitBranch',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    if (parsedInputs.branch) validateGitRef(parsedInputs.branch);

    const tenantId = (context as any).tenantId ?? context.runId;
    const volume = createIsolatedVolume(tenantId, context.runId);
    const branch = parsedInputs.branch || 'HEAD';

    try {
      await volume.initialize({});
      const token = parsedInputs.installationId
        ? await fetchInstallationToken(parsedInputs.installationId, context, '[GitHub Clone Many]')
        : null;

      const commands = [
        'set -eu',
        'mkdir -p /workspace/repos',
        'git config --global --add safe.directory "*"',
      ];

      for (const repository of parsedInputs.repositories) {
        const dir = repoDir(repository);
        const url = token
          ? `https://x-access-token:$GITHUB_TOKEN@github.com/${repository}.git`
          : `https://github.com/${repository}.git`;
        const depthArgs = parsedParams.depth > 0 ? `--depth ${parsedParams.depth}` : '';
        const branchArgs = parsedInputs.branch ? `--branch "$GIT_BRANCH"` : '';
        commands.push(
          `git clone ${depthArgs} ${branchArgs} "${url}" "/workspace/repos/${dir}"`,
          `cd "/workspace/repos/${dir}" && git rev-parse HEAD > "/workspace/${dir}.commit"`,
        );
      }

      const baseRunner = definition.runner;
      if (baseRunner.kind !== 'docker') {
        throw new ContainerError('Clone-many runner must be docker');
      }
      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: ['-c', commands.join(' && ')],
        env: {
          ...baseRunner.env,
          GITHUB_TOKEN: token ?? '',
          ...(parsedInputs.branch ? { GIT_BRANCH: parsedInputs.branch } : {}),
        },
        volumes: [volume.getVolumeConfig('/workspace', false)],
        expectOutputFile: false,
      };

      const rawResult = await runComponentWithRunner<typeof parsedInputs, unknown>(
        runnerConfig,
        async () => ({}) as unknown,
        parsedInputs,
        context,
      );

      const parsedResult = runnerOutputSchema.safeParse(rawResult);
      if (parsedResult.success && parsedResult.data.exitCode !== 0) {
        throw new ContainerError(
          `Clone-many git command failed: ${sanitizeForLogging(parsedResult.data.stderr).slice(0, 500)}`,
        );
      }

      const commitFiles = parsedInputs.repositories.map(
        (repository) => `${repoDir(repository)}.commit`,
      );
      const files = await volume.readFiles(commitFiles);
      const commitMap = Object.fromEntries(
        parsedInputs.repositories.map((repository) => [
          repository,
          files[`${repoDir(repository)}.commit`]?.trim() || 'unknown',
        ]),
      );

      return outputSchema.parse({
        volumeName: volume.getVolumeName()!,
        repositories: parsedInputs.repositories,
        repository: parsedInputs.repositories.join(','),
        branch,
        commitMap,
      });
    } catch (error) {
      await volume.cleanup().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(`Clone-many failed: ${sanitizeForLogging(message)}`);
    }
  },
});

componentRegistry.register(definition);
