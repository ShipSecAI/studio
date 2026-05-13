import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { securityWikiContextSchema } from '../core/security-wiki-context';

const execFile = promisify(execFileCb);

const inputSchema = inputs({
  repoPath: port(z.string().optional(), {
    label: 'Repository Path',
    description:
      'Host path to repository checkout. Mounted read-only when wiki context is not provided.',
  }),
  wikiPath: port(z.string().optional(), {
    label: 'Security Wiki Path',
    description:
      'Host path to git-backed security wiki checkout when wiki context is not provided.',
  }),
  repoSlug: port(z.string().optional(), {
    label: 'Repository Slug',
    description: 'Stable repo slug, e.g. shipsecai-studio.',
  }),
  runId: port(z.string().optional(), {
    label: 'CODE Run ID',
    description: 'Optional deterministic run id.',
  }),
  promptText: port(z.string().optional(), {
    label: 'Prompt Text',
    description: 'Optional CODE prompt override.',
  }),
  wikiContext: port(securityWikiContextSchema.optional(), {
    label: 'Security Wiki Context',
    description:
      'Optional wiki mount/instruction context from the Security Wiki Context component.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  model: param(z.string().default('gpt-5.5'), { label: 'Codex Model', editor: 'text' }),
  codexHome: param(z.string().default('/tmp/codex-home-test'), {
    label: 'Codex Home Mount',
    editor: 'text',
  }),
  nodeImage: param(z.string().default('node:26-bookworm'), {
    label: 'Runtime Image',
    editor: 'text',
  }),
});

const outputSchema = outputs({
  runId: port(z.string(), { label: 'Run ID' }),
  status: port(z.string(), { label: 'Status' }),
  changedFiles: port(z.array(z.string()), { label: 'Changed Wiki Files' }),
  outputCommit: port(z.string().optional(), { label: 'Output Commit' }),
  mergeCommit: port(z.string().optional(), { label: 'Merge Commit' }),
  rawOutput: port(z.string(), { label: 'Raw Agent Output' }),
});

const DEFAULT_PROMPT = `/goal Write a comprehensive product security wiki for this repository. Spend as much time as needed to understand the product, its architecture, security boundaries, trust assumptions, data flows, deployment/runtime surfaces, agent/workflow surfaces, authentication/authorization model, sensitive data paths, external integrations, cloud/infrastructure touchpoints, and every security-relevant surface an engineer or CISO would need to reason about later.

You are code-explorer-agent running inside a ShipSec CODE workflow.

Mounted paths:
- /workspace/repo: read-only repo checkout
- /workspace/wiki: writable security wiki checkout

Use parallel subagents if Codex supports them in this runtime. Ask them to independently inspect major product areas such as frontend, backend/API, worker/workflows/components, database/schema, integrations, auth, cloud/infra, and security tooling. Merge their findings into the wiki. If subagents are not available, perform the same work as separate focused passes.

Write a rich, durable, file-first product security wiki. You may create any pages and directories that help future agents rediscover the product. Include:
- Clear product overview and mental model
- Tables for services, APIs, data stores, secrets, integrations, trust boundaries, workflows, components, and security-sensitive routes
- Mermaid diagrams for architecture, data flow, workflow execution, auth, and deployment where useful
- Evidence-linked notes with source paths, symbols, routes, config files, migrations, or scripts
- Open questions, assumptions, and investigation leads
- Security-relevant surfaces and why each matters

Do not modify /workspace/repo. Do not run git commit. Write durable wiki files under /workspace/wiki. Final response: changed wiki files only.`;

const definition = defineComponent({
  id: 'core.ai.codex',
  label: 'Codex Agent',
  category: 'ai',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs Codex in Docker as a normal agent component. When wired to Security Wiki Context, mounts repo/wiki paths and writes wiki files.',
  ui: {
    slug: 'codex-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'Docker-backed Codex agent with optional security-wiki mode.',
    icon: 'Bot',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
  },
  async execute({ inputs, params }, context) {
    const wikiContext = inputs.wikiContext;
    const repoPathInput = wikiContext?.repoPath ?? inputs.repoPath;
    const wikiPathInput = wikiContext?.wikiPath ?? inputs.wikiPath;
    if (!repoPathInput || !wikiPathInput) {
      throw new Error(
        'Codex wiki mode requires repoPath and wikiPath, either directly or via wikiContext.',
      );
    }
    const repoPath = resolve(repoPathInput);
    const sourceWikiPath = resolve(wikiPathInput);
    const runId = wikiContext?.runId ?? inputs.runId ?? `code_${context.runId}`;
    const repoSlug = wikiContext?.repoSlug ?? inputs.repoSlug ?? 'unknown-repo';
    const workspace = mkdtempSync(join(tmpdir(), 'shipsec-code-wiki-'));
    const branchName = `shipsec/agent/code-explorer-agent/${runId}`;
    let rawOutput = '';
    try {
      context.emitProgress({ level: 'info', message: 'Preparing security wiki checkout...' });
      const wikiPath = join(workspace, 'wiki');
      await git(dirname(wikiPath), ['clone', sourceWikiPath, basename(wikiPath)]);
      await git(wikiPath, ['checkout', '-b', branchName]);
      const wikiBaseCommit = await git(wikiPath, ['rev-parse', 'HEAD'])
        .then((s) => s.trim())
        .catch(() => 'unknown');
      const repoCommit = await git(repoPath, ['rev-parse', 'HEAD'])
        .then((s) => s.trim())
        .catch(() => 'unknown');
      const promptPath = join(workspace, 'prompt.md');
      const promptText = [wikiContext?.instructions, inputs.promptText?.trim() || DEFAULT_PROMPT]
        .filter(Boolean)
        .join('\n\n');
      await Bun.write(promptPath, promptText);

      context.emitProgress({
        level: 'info',
        message: 'Running Codex CODE wiki agent in Docker...',
      });
      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: params.nodeImage,
        entrypoint: 'bash',
        command: [
          '-lc',
          [
            'set -e',
            'cd /workspace',
            'npm install -g @openai/codex --include=optional >/tmp/codex-install.log 2>&1 || { cat /tmp/codex-install.log >&2; exit 86; }',
            'codex --version >/tmp/codex-version.log 2>&1 || { cat /tmp/codex-install.log >&2; cat /tmp/codex-version.log >&2; exit 87; }',
            'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m "$SHIPSEC_AGENT_MODEL" -c model_reasoning_effort="low" -C /workspace "$(cat /workspace/prompt.md)"',
          ].join('; '),
        ],
        network: 'bridge',
        env: {
          SHIPSEC_RUN_ID: runId,
          SHIPSEC_AGENT_NAME: wikiContext?.agentName ?? 'code-explorer-agent',
          SHIPSEC_AGENT_MODEL: params.model,
          SHIPSEC_REPO_SLUG: repoSlug,
          SHIPSEC_REPO_COMMIT: repoCommit,
          SHIPSEC_WIKI_BASE_COMMIT: wikiBaseCommit,
        },
        volumes: [
          { source: params.codexHome, target: '/root/.codex', readOnly: false },
          { source: repoPath, target: '/workspace/repo', readOnly: true },
          {
            source: wikiPath,
            target: '/workspace/wiki',
            readOnly: wikiContext?.accessMode === 'read',
          },
          { source: promptPath, target: '/workspace/prompt.md', readOnly: true },
        ],
        timeoutSeconds: 7200,
        expectOutputFile: false,
        stdinJson: false,
      };
      const runnerResult = await runComponentWithRunner(
        runnerConfig,
        async (raw) => raw,
        {},
        context,
      );
      rawOutput = typeof runnerResult === 'string' ? runnerResult : JSON.stringify(runnerResult);

      const changedFiles = await changed(wikiPath);
      if (wikiContext?.accessMode === 'read') {
        return outputSchema.parse({
          runId,
          status: 'read_only_completed',
          changedFiles,
          rawOutput,
        });
      }
      await validate(changedFiles);
      if (changedFiles.length === 0)
        throw new Error('Codex CODE wiki agent produced no changed files');

      await git(wikiPath, ['add', ...changedFiles]);
      await git(wikiPath, [
        '-c',
        'user.name=ShipSec Agent',
        '-c',
        'user.email=agent@shipsec.ai',
        'commit',
        '-m',
        `agent(code-explorer-agent): update security wiki for ${repoSlug}`,
        '-m',
        `Run: ${runId}\nRepo: ${repoSlug}@${repoCommit}\nWiki-Base: ${wikiBaseCommit}\nModel: ${params.model}`,
      ]);
      const outputCommit = await git(wikiPath, ['rev-parse', 'HEAD']).then((s) => s.trim());
      await git(sourceWikiPath, ['fetch', wikiPath, branchName]);
      await git(sourceWikiPath, ['merge', '--ff-only', 'FETCH_HEAD']);
      const mergeCommit = await git(sourceWikiPath, ['rev-parse', 'HEAD']).then((s) => s.trim());

      return outputSchema.parse({
        runId,
        status: 'merged',
        changedFiles,
        outputCommit,
        mergeCommit,
        rawOutput,
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
});

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 10 });
  return stdout;
}

async function changed(wikiPath: string) {
  const out = await git(wikiPath, ['status', '--porcelain', '--untracked-files=all']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export async function validate(files: string[]) {
  for (const file of files) {
    if (file.startsWith('/') || file.includes('..')) throw new Error(`Invalid wiki path: ${file}`);
  }
}

componentRegistry.register(definition);
export default definition;
