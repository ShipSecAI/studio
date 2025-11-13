#!/usr/bin/env bun
/**
 * Bulk import ShipSec workflows from a directory of JSON files.
 *
 * Usage examples:
 *   bun scripts/workflows-import.ts --dir ./workflows
 *   bun scripts/workflows-import.ts            # uses WORKFLOW_IMPORT_DIR
 *
 * The script will:
 *   - Read every .json/.workflow.json file in the target directory
 *   - Validate the payload shape against a relaxed workflow schema
 *   - Create or update workflows via the backend API (matching on name)
 *   - Log success, skips, and failures for each file
 */

import { promises as fs, existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const DEFAULT_BASE_URL = 'http://localhost:3211/api/v1';
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;

const WorkflowViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

const WorkflowNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
  })
  .passthrough();

const WorkflowEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().min(1).optional(),
    targetHandle: z.string().min(1).optional(),
  })
  .passthrough();

const WorkflowGraphFragmentSchema = z
  .object({
    nodes: z.array(WorkflowNodeSchema).min(1),
    edges: z.array(WorkflowEdgeSchema),
    viewport: WorkflowViewportSchema.optional(),
  })
  .passthrough();

const WorkflowFileSchema = z.union([
  z
    .object({
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      nodes: z.array(WorkflowNodeSchema).min(1),
      edges: z.array(WorkflowEdgeSchema),
      viewport: WorkflowViewportSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      name: z.string().min(1),
      description: z.string().optional().nullable(),
      graph: WorkflowGraphFragmentSchema,
    })
    .passthrough(),
]);

type WorkflowFile = z.infer<typeof WorkflowFileSchema>;

type WorkflowPayload = {
  id?: string;
  name: string;
  description?: string;
  nodes: unknown[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
};

type ExistingWorkflow = {
  id: string;
  name: string;
};

type ImportStats = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
};

type AuthOptions =
  | { kind: 'none' }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'bearer'; token: string };

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_WORKFLOW_DIR = resolve(BACKEND_ROOT, '../workflows');

function resolveEnvPath(relative: string): string {
  return resolve(SCRIPT_DIR, relative);
}

function resolveImportDirectory({
  cliDir,
  envDir,
}: {
  cliDir?: string;
  envDir?: string;
}): string | undefined {
  if (cliDir) {
    return resolve(cliDir);
  }

  if (envDir?.trim()) {
    const normalized = envDir.trim();
    return isAbsolute(normalized) ? normalized : resolve(BACKEND_ROOT, normalized);
  }

  return DEFAULT_WORKFLOW_DIR;
}

function loadEnvironment() {
  const cwdEnvPath = resolve(process.cwd(), '.env');
  if (existsSync(cwdEnvPath)) {
    loadEnv({ path: cwdEnvPath, override: false });
  }

  const backendEnvPath = resolveEnvPath('../.env');
  if (existsSync(backendEnvPath) && backendEnvPath !== cwdEnvPath) {
    loadEnv({ path: backendEnvPath, override: false });
  }
}

function parseArgs(): {
  dir?: string;
  baseUrl: string;
  helpRequested: boolean;
  basicAuthCli?: string;
  bearerTokenCli?: string;
} {
  const args = process.argv.slice(2);
  let dir: string | undefined;
  let baseUrl = process.env.WORKFLOW_IMPORT_BASE_URL || DEFAULT_BASE_URL;
  let helpRequested = false;
  let basicAuthCli: string | undefined;
  let bearerTokenCli: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir':
      case '-d':
        dir = args[i + 1];
        i += 1;
        break;
      case '--base-url':
        baseUrl = args[i + 1] ?? baseUrl;
        i += 1;
        break;
      case '--basic-auth':
        basicAuthCli = args[i + 1];
        i += 1;
        break;
      case '--bearer-token':
        bearerTokenCli = args[i + 1];
        i += 1;
        break;
      case '--help':
      case '-h':
        helpRequested = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.warn(`⚠️  Unknown option "${arg}" (use --help to see usage).`);
        }
        break;
    }
  }

  return { dir, baseUrl, helpRequested, basicAuthCli, bearerTokenCli };
}

function printHelp(): void {
  console.log(`ShipSec Workflow Import CLI

Usage: bun scripts/workflows-import.ts [options]

Options:
  -d, --dir <path>        Directory containing workflow JSON files
      --base-url <url>    Backend API base URL (default: ${DEFAULT_BASE_URL})
      --basic-auth <u:p>  Send HTTP Basic auth using "username:password"
      --bearer-token <t>  Send Authorization: Bearer <token>
  -h, --help              Show this message

Environment variables:
  WORKFLOW_IMPORT_DIR         Default directory when --dir is not provided
  WORKFLOW_IMPORT_BASE_URL    Override backend API base URL
  WORKFLOW_IMPORT_BASIC_AUTH  Default Basic auth credentials (username:password)
  WORKFLOW_IMPORT_BEARER_TOKEN Default bearer token for Authorization header
`);
}

async function ensureDirectory(path: string): Promise<string[]> {
  try {
    const stats = await fs.stat(path);
    if (!stats.isDirectory()) {
      throw new Error(`${path} is not a directory`);
    }
  } catch (error) {
    throw new Error(`Unable to access directory "${path}": ${(error as Error).message}`);
  }

  const entries = await fs.readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => {
      const lower = entry.name.toLowerCase();
      return lower.endsWith('.json') || lower.endsWith('.workflow.json');
    })
    .map((entry) => join(path, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readWorkflowFile(filePath: string): Promise<{ payload: WorkflowPayload; nameKey: string }> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: WorkflowFile;

  try {
    const json = JSON.parse(raw);
    parsed = WorkflowFileSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `• ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      throw new Error(`Validation failed:\n${issues.join('\n')}`);
    }
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }

  const graph = 'graph' in parsed ? parsed.graph : parsed;
  const viewport = graph.viewport ?? DEFAULT_VIEWPORT;

  const payload: WorkflowPayload = {
    name: parsed.name.trim(),
    description: parsed.description ?? undefined,
    nodes: graph.nodes,
    edges: graph.edges,
    viewport,
  };

  const nameKey = payload.name.toLowerCase();
  return { payload, nameKey };
}

function buildApiUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, '');
  return new URL(normalizedPath, normalizedBase);
}

function sanitizeAuthValue(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBasicAuth(value: string): { username: string; password: string } {
  const separator = value.indexOf(':');
  if (separator === -1) {
    throw new Error('Basic auth credentials must use the format "username:password".');
  }
  const username = value.slice(0, separator);
  const password = value.slice(separator + 1);
  if (!username || !password) {
    throw new Error('Basic auth requires both username and password.');
  }
  return { username, password };
}

function resolveAuthOptions({
  basicAuthCli,
  bearerTokenCli,
}: {
  basicAuthCli?: string;
  bearerTokenCli?: string;
}): AuthOptions {
  const basicAuth = sanitizeAuthValue(basicAuthCli) ?? sanitizeAuthValue(process.env.WORKFLOW_IMPORT_BASIC_AUTH);
  const bearer = sanitizeAuthValue(bearerTokenCli) ?? sanitizeAuthValue(process.env.WORKFLOW_IMPORT_BEARER_TOKEN);

  if (basicAuth && bearer) {
    throw new Error('Provide only one auth method (Basic or Bearer).');
  }

  if (basicAuth) {
    const { username, password } = parseBasicAuth(basicAuth);
    return { kind: 'basic', username, password };
  }

  if (bearer) {
    return { kind: 'bearer', token: bearer };
  }

  return { kind: 'none' };
}

function buildAuthHeaders(auth: AuthOptions): Record<string, string> {
  if (auth.kind === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  if (auth.kind === 'bearer') {
    return { Authorization: `Bearer ${auth.token}` };
  }
  return {};
}

async function fetchExistingWorkflows(baseUrl: string, headers: Record<string, string>): Promise<Map<string, ExistingWorkflow>> {
  const map = new Map<string, ExistingWorkflow>();

  try {
    const response = await fetch(buildApiUrl(baseUrl, '/workflows'), { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as Array<{ id: string; name: string }> | undefined;
    if (Array.isArray(data)) {
      for (const workflow of data) {
        if (workflow?.id && workflow?.name) {
          map.set(workflow.name.toLowerCase(), { id: workflow.id, name: workflow.name });
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to load existing workflows: ${(error as Error).message}`);
  }

  return map;
}

async function createWorkflow(baseUrl: string, payload: WorkflowPayload, headers: Record<string, string>) {
  const response = await fetch(buildApiUrl(baseUrl, '/workflows'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await safeReadErrorBody(response);
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
  }

  return (await response.json()) as { id: string };
}

async function updateWorkflow(baseUrl: string, id: string, payload: WorkflowPayload, headers: Record<string, string>) {
  const response = await fetch(buildApiUrl(baseUrl, `/workflows/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ ...payload, id }),
  });

  if (!response.ok) {
    const body = await safeReadErrorBody(response);
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
  }

  return (await response.json()) as { id: string };
}

async function safeReadErrorBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text ? text.slice(0, 500) : null;
  } catch {
    return null;
  }
}

export async function importWorkflows({
  directory,
  baseUrl,
  headers,
}: {
  directory: string;
  baseUrl: string;
  headers: Record<string, string>;
}) {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const existingByName = await fetchExistingWorkflows(baseUrl, headers);
  const processedNames = new Set<string>();

  console.log(`📁 Loading workflows from ${directory}`);
  const files = await ensureDirectory(directory);
  if (files.length === 0) {
    console.warn('⚠️  No workflow files found (expected *.json or *.workflow.json).');
    return stats;
  }

  console.log(`🔍 Found ${files.length} candidate file${files.length === 1 ? '' : 's'}.`);

  for (const filePath of files) {
    const fileName = basename(filePath);

    try {
      const { payload, nameKey } = await readWorkflowFile(filePath);

      if (processedNames.has(nameKey)) {
        console.warn(`⚠️  Skipping ${fileName}: duplicate workflow name "${payload.name}" in directory.`);
        stats.skipped += 1;
        continue;
      }
      processedNames.add(nameKey);

      const existing = existingByName.get(nameKey);
      if (existing) {
        await updateWorkflow(baseUrl, existing.id, payload, headers);
        console.log(`✅ Updated "${payload.name}" from ${fileName}`);
        stats.updated += 1;
      } else {
        await createWorkflow(baseUrl, payload, headers);
        console.log(`✅ Imported "${payload.name}" from ${fileName}`);
        stats.created += 1;
      }
    } catch (error) {
      console.error(`❌ Failed to import ${fileName}: ${(error as Error).message}`);
      stats.failed += 1;
    }
  }

  return stats;
}

async function main() {
  loadEnvironment();

  const { dir, baseUrl, helpRequested, basicAuthCli, bearerTokenCli } = parseArgs();
  if (helpRequested) {
    printHelp();
    return;
  }

  let authOptions: AuthOptions;
  try {
    authOptions = resolveAuthOptions({ basicAuthCli, bearerTokenCli });
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const headers = buildAuthHeaders(authOptions);

  const directory = resolveImportDirectory({ cliDir: dir, envDir: process.env.WORKFLOW_IMPORT_DIR });
  if (!directory) {
    console.error('❌ No import directory provided. Use --dir or set WORKFLOW_IMPORT_DIR in your environment.');
    process.exitCode = 1;
    return;
  }
  const resolvedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  console.log('🚀 ShipSec workflow importer');
  console.log(`   ↳ Directory: ${directory}`);
  console.log(`   ↳ API Base:  ${resolvedBaseUrl}`);
  if (authOptions.kind === 'none') {
    console.log('   ↳ Auth:      none (set --basic-auth or --bearer-token if required)');
  } else {
    console.log(`   ↳ Auth:      ${authOptions.kind}`);
  }

  try {
    const stats = await importWorkflows({
      directory,
      baseUrl: resolvedBaseUrl,
      headers,
    });

    console.log('\n📦 Import summary');
    console.log(`   Created: ${stats.created}`);
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Skipped: ${stats.skipped}`);
    console.log(`   Failed:  ${stats.failed}`);

    if (stats.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`❌ Import aborted: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  // eslint-disable-next-line unicorn/prefer-top-level-await -- explicit main for clarity
  main();
}
