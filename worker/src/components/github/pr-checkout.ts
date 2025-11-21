import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const execFileAsync = promisify(execFile);

const inputSchema = z.object({
  repoFullName: z.string().min(1).describe('owner/repo'),
  ref: z.string().min(1).describe('Branch name or commit SHA'),
  token: z.string().min(1).optional().describe('GitHub token (installation/user) for private repos'),
  depth: z.number().int().positive().max(1000).default(1).describe('Shallow clone depth'),
  clean: z.boolean().default(false).describe('Remove the checkout after completion'),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  workspacePath: z.string(),
  repoFullName: z.string(),
  ref: z.string(),
  commitSha: z.string(),
});

type Output = z.infer<typeof outputSchema>;

const shaPattern = /^[0-9a-f]{7,40}$/i;

async function runGit(args: string[], cwd?: string) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 5 * 60 * 1000,
  });
  return { stdout: stdout?.trim() ?? '', stderr: stderr?.trim() ?? '' };
}

async function checkoutRepo(input: Input): Promise<Output> {
  const baseDir = await mkdtemp(join(tmpdir(), 'shipsec-github-'));
  const repoPath = join(baseDir, 'repo');

  const authPrefix = input.token ? `https://x-access-token:${input.token}@` : 'https://';
  const repoUrl = `${authPrefix}github.com/${input.repoFullName}.git`;

  // Clone shallow by ref (branch) when possible; fall back to fetch/checkout for SHAs
  const cloneArgs = ['clone', '--no-tags', `--depth=${input.depth}`, repoUrl, repoPath];
  if (!shaPattern.test(input.ref)) {
    cloneArgs.splice(3, 0, '--branch', input.ref);
  }

  await runGit(cloneArgs);

  if (shaPattern.test(input.ref)) {
    await runGit(['fetch', 'origin', input.ref], repoPath);
    await runGit(['checkout', input.ref], repoPath);
  }

  const { stdout } = await runGit(['rev-parse', 'HEAD'], repoPath);
  const commitSha = stdout.trim();

  // Clean up if requested (may not be desirable in pipelines that need the path after completion)
  if (input.clean) {
    await rm(baseDir, { recursive: true, force: true });
  }

  return {
    workspacePath: input.clean ? '' : repoPath,
    repoFullName: input.repoFullName,
    ref: input.ref,
    commitSha,
  };
}

const component: ComponentDefinition<Input, Output> = {
  id: 'github.pr.checkout',
  name: 'GitHub PR Checkout',
  description: 'Fetches a PR branch/commit into an isolated workspace for downstream scanners.',
  icon: 'github',
  inputSchema,
  outputSchema,
  requiresSecrets: false,
  run: async (params) => {
    return checkoutRepo(params);
  },
};

componentRegistry.register(component);
