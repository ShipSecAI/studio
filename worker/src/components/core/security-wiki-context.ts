import { resolve } from 'node:path';
import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

export const securityWikiContextSchema = z.object({
  enabled: z.literal(true),
  wikiId: z.string().optional(),
  wikiPath: z.string().min(1),
  repoPath: z.string().optional(),
  repoSlug: z.string().min(1),
  runId: z.string().min(1),
  agentName: z.string().min(1),
  accessMode: z.enum(['read', 'write']),
  instructions: z.string().min(1),
  allowedPaths: z.array(z.string()),
  env: z.record(z.string(), z.string()),
});
export type SecurityWikiContext = z.infer<typeof securityWikiContextSchema>;

const inputSchema = inputs({});

const parameterSchema = parameters({
  wikiId: param(z.string().optional(), {
    label: 'Wiki ID',
    editor: 'text',
  }),
  wikiPath: param(z.string().min(1), {
    label: 'Security Wiki Path',
    editor: 'text',
  }),
  wikiAccess: param(z.enum(['read', 'write']).default('write'), {
    label: 'Wiki Access',
    editor: 'select',
    options: [
      { label: 'Read-only', value: 'read' },
      { label: 'Read/write', value: 'write' },
    ],
  }),
  repoPath: param(z.string().optional(), {
    label: 'Repository Path',
    editor: 'text',
  }),
  repoSlug: param(z.string().default('unknown-repo'), {
    label: 'Repository Slug',
    editor: 'text',
  }),
  runId: param(z.string().optional(), {
    label: 'Wiki Run ID',
    editor: 'text',
  }),
  mode: param(z.enum(['repo-security', 'clear-analysis', 'general']).default('repo-security'), {
    label: 'Wiki Mode',
    editor: 'select',
    options: [
      { label: 'Repository Security', value: 'repo-security' },
      { label: 'Clear Analysis', value: 'clear-analysis' },
      { label: 'General Wiki Writer', value: 'general' },
    ],
  }),
  agentName: param(z.string().default('code-explorer-agent'), {
    label: 'Agent Name',
    editor: 'text',
  }),
});

const outputSchema = outputs({
  wikiContext: port(securityWikiContextSchema, {
    label: 'Wiki Context',
    description: 'Structured mount/instruction context that can be wired into any agent.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  instructions: port(z.string(), { label: 'Wiki Instructions' }),
  wikiPath: port(z.string(), { label: 'Wiki Path' }),
  repoPath: port(z.string().optional(), { label: 'Repository Path' }),
  repoSlug: port(z.string(), { label: 'Repository Slug' }),
  runId: port(z.string(), { label: 'Wiki Run ID' }),
});

const definition = defineComponent({
  id: 'security.wiki.context',
  label: 'Security Wiki Context',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Selects a security wiki and prepares mount context/instructions that can be wired into any agent component.',
  ui: {
    slug: 'security-wiki-context',
    version: '1.0.0',
    type: 'input',
    category: 'security',
    description: 'Select a security wiki as read-only or read/write context for an agent.',
    icon: 'BookOpen',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
  },
  async execute({ params }, context) {
    const runId = params.runId?.trim() || context.runId;
    const repoSlug = params.repoSlug.trim() || 'unknown-repo';
    const allowedPaths: string[] = [];
    const repoLine = params.repoPath
      ? '- `/workspace/repo`: read-only repository checkout mounted by the agent component.'
      : '- No repository mount was provided; use the wiki only.';
    const wikiLine =
      params.wikiAccess === 'read'
        ? '- `/workspace/wiki`: read-only security wiki context.'
        : '- `/workspace/wiki`: writable agent-owned security wiki.';
    const writeRules =
      params.wikiAccess === 'read'
        ? '- Do not modify files under `/workspace/wiki`; use it only as durable context.'
        : `- The wiki is pure files plus git. You write files; ShipSec runtime commits after validation.
- Do not run git commit.
- Write a manifest at \`/workspace/wiki/agent-state/manifests/${runId}.yaml\`.
- Organize files wherever they make sense inside \`/workspace/wiki\`. Prefer stable paths and names agents can rediscover later.`;
    const modeHint =
      params.mode === 'clear-analysis'
        ? 'Write focused clear-analysis pages with evidence tables, assumptions, unknowns, and proposed patches/tests.'
        : params.mode === 'repo-security'
          ? `Write a comprehensive product security wiki, not a shallow repo summary.

Start the agent task with this goal:
\`/goal Write a comprehensive product security wiki for this repository. Spend as much time as needed to understand the product, architecture, security boundaries, trust assumptions, data flows, runtime/deployment surfaces, agent/workflow surfaces, authentication/authorization model, sensitive data paths, external integrations, cloud/infrastructure touchpoints, and every security-relevant surface an engineer or CISO would need to reason about later.\`

Use parallel subagents if Codex supports them in this runtime. Ask them to independently inspect major product areas such as frontend, backend/API, worker/workflows/components, database/schema, integrations, auth, cloud/infra, and security tooling. Merge their findings into the wiki. If subagents are not available, perform the same work as separate focused passes.

Write rich wiki pages with:
- Tables for services, APIs, data stores, secrets, integrations, trust boundaries, workflows, components, and security-sensitive routes.
- Mermaid diagrams for architecture, data flow, workflow execution, auth, and deployment where useful.
- Evidence-linked notes with source paths, symbols, routes, config files, migrations, or scripts.
- Open questions, assumptions, investigation leads, and security-relevant surfaces with why each matters.
- Any pages or directories that make the product easier for future security agents to rediscover.`
          : 'Write organized wiki pages appropriate to the task. Prefer stable paths and small leaf files.';

    const instructions = `# Security Wiki Mode

You are ${params.agentName}. A git-backed security wiki is mounted into this agent run.

Mounted paths expected by the agent component:
${wikiLine}
${repoLine}

Rules:
${writeRules}
- Do not write raw scanner dumps or huge artifacts. Use pointers and source citations.
- Humans never manually edit this wiki. Treat it as durable org security memory.
- Prefer organized leaf files over a single large document.
- Durable claims must cite source paths, routes, symbols, or artifact refs.
- Use repo slug \`${repoSlug}\` for repo-specific paths under \`assets/repos/${repoSlug}/\`.

Mode guidance:
${modeHint}
`;

    const wikiContext = securityWikiContextSchema.parse({
      enabled: true,
      wikiId: params.wikiId?.trim() || undefined,
      wikiPath: resolve(params.wikiPath),
      repoPath: params.repoPath ? resolve(params.repoPath) : undefined,
      repoSlug,
      runId,
      agentName: params.agentName,
      accessMode: params.wikiAccess,
      instructions,
      allowedPaths,
      env: {
        SHIPSEC_RUN_ID: runId,
        SHIPSEC_AGENT_NAME: params.agentName,
        SHIPSEC_REPO_SLUG: repoSlug,
      },
    });

    return outputSchema.parse({
      wikiContext,
      instructions,
      wikiPath: wikiContext.wikiPath,
      repoPath: wikiContext.repoPath,
      repoSlug,
      runId,
    });
  },
});

componentRegistry.register(definition);
export default definition;
