import { ConfigurationError } from '@shipsec/component-sdk';
import { createInternalBackendClient } from '../../utils/internal-backend-client';
import { getBackendOrigin } from '../../utils/backend-url';
import { createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolSet } from 'ai';

export const DEFAULT_API_BASE_URL = getBackendOrigin({ preferDockerHost: true });

/**
 * Connect to a Hotplug session endpoint and return the discovered tools.
 * Uses @ai-sdk/mcp with a pre-built StreamableHTTPClientTransport for
 * proper Streamable HTTP MCP compatibility with Hotplug.
 */
export async function connectToHotplugTools(
  mcpUrl: string,
  mcpToken: string,
  createClient: typeof createMCPClient = createMCPClient,
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  console.log(`[Agent] Connecting to Hotplug MCP session at ${mcpUrl}`);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${mcpToken}` },
    },
  });

  const mcpClient = await createClient({ transport });

  const tools = await mcpClient.tools();
  console.log(
    `[Agent] Discovered ${Object.keys(tools).length} tools from Hotplug: ${Object.keys(tools).join(', ') || 'none'}`,
  );

  return {
    tools: tools as ToolSet,
    close: async () => {
      await mcpClient.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Shared LiteLLM helpers (used by ai-agent.ts and llm-generate-text.ts)
// ---------------------------------------------------------------------------

export function shouldRouteViaLiteLLM(): boolean {
  return (process.env.LITELLM_BASE_URL?.trim() ?? '').length > 0;
}

export function getLiteLLMBaseUrl(): string {
  return process.env.LITELLM_BASE_URL?.trim() ?? '';
}

export function getLiteLLMApiKey(): string {
  return process.env.LITELLM_API_KEY?.trim() ?? '';
}

function normalizeBackendOrigin(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
}

export function normalizeLiteLLMModel(provider: string, model: string): string {
  if (model.includes('/')) {
    return model;
  }
  if (provider === 'gemini') {
    return `gemini/${model}`;
  }
  if (provider === 'openrouter') {
    return `openrouter/${model}`;
  }
  if (provider === 'zai-coding-plan') {
    return `openai/${model}`;
  }
  return model;
}

// ---------------------------------------------------------------------------
// LiteLLM virtual key resolution (calls backend internal API)
// ---------------------------------------------------------------------------

/** In-memory cache: orgId → virtual key */
const virtualKeyCache = new Map<string, string>();

/**
 * Fetch the LiteLLM virtual key for an organization from the backend.
 * Caches results in-memory to avoid repeated calls.
 * Returns null if LiteLLM is not configured or the key cannot be resolved.
 */
export async function fetchOrgVirtualKey(
  orgId: string,
  backendUrl?: string,
): Promise<string | null> {
  if (!shouldRouteViaLiteLLM()) return null;

  const cached = virtualKeyCache.get(orgId);
  if (cached) return cached;

  const baseUrl = normalizeBackendOrigin(
    backendUrl ??
      process.env.STUDIO_API_BASE_URL ??
      process.env.SHIPSEC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      DEFAULT_API_BASE_URL,
  );

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) return null;

  try {
    const client = createInternalBackendClient({ baseUrl });
    const res: { data?: { virtualKey?: string | null } } = await client.getLiteLLMVirtualKey(orgId);
    const data = res.data;
    if (!data) return null;
    if (!data.virtualKey) return null;

    virtualKeyCache.set(orgId, data.virtualKey);
    return data.virtualKey;
  } catch {
    return null;
  }
}

export async function requireOrgVirtualKey(
  orgId: string | null | undefined,
  options?: { backendUrl?: string; consumer?: string },
): Promise<string> {
  if (!shouldRouteViaLiteLLM()) {
    throw new ConfigurationError('LiteLLM routing is not enabled.', {
      configKey: 'LITELLM_BASE_URL',
    });
  }

  if (!orgId?.trim()) {
    throw new ConfigurationError(
      `${options?.consumer ?? 'AI request'} requires an organization ID when LiteLLM routing is enabled.`,
      { configKey: 'organizationId' },
    );
  }

  const virtualKey = await fetchOrgVirtualKey(orgId.trim(), options?.backendUrl);
  if (!virtualKey) {
    throw new ConfigurationError(
      `${options?.consumer ?? 'AI request'} could not resolve a LiteLLM virtual key for organization "${orgId}".`,
      {
        configKey: 'LITELLM_API_KEY',
        details: { organizationId: orgId.trim() },
      },
    );
  }

  return virtualKey;
}

// ---------------------------------------------------------------------------
// Agent Skills helpers (fetch from backend, generate SKILL.md files)
// ---------------------------------------------------------------------------

export interface AgentSkillData {
  id: string;
  name: string;
  description: string;
  content: string;
  allowedTools?: string | null;
}

/**
 * Fetch enabled agent skills for an organization from the backend internal API.
 */
export async function fetchOrgSkills(organizationId: string | null): Promise<AgentSkillData[]> {
  try {
    const client = createInternalBackendClient({
      headers: organizationId ? { 'X-Organization-Id': organizationId } : undefined,
    });
    const res = await client.listEnabledAgentSkills();
    if (!res.data) return [];
    return res.data as AgentSkillData[];
  } catch {
    return [];
  }
}

/**
 * Generate a SKILL.md file from stored skill data.
 * Format follows the Agent Skills open standard (https://agentskills.io).
 */
export function generateSkillMd(skill: AgentSkillData): string {
  const lines: string[] = ['---', `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.allowedTools) {
    lines.push(`allowed-tools: ${skill.allowedTools}`);
  }
  lines.push('---', '', skill.content);
  return lines.join('\n');
}

/**
 * Generate workspace file entries for selected org skills.
 * Returns a record of path → content for use with volume.initialize().
 *
 * @param organizationId - Organization to fetch skills for
 * @param selectedSkillNames - If provided, only include skills with these names.
 *                             If empty array, no skills are injected.
 *                             If undefined/null, no skills are injected (opt-in).
 * @param skillsDir - Directory prefix for skill files.
 *                    Claude Code uses `.claude/skills`, OpenCode uses `.agents/skills`.
 */
export async function getSkillWorkspaceFiles(
  organizationId: string | null,
  selectedSkillNames?: string[] | null,
  skillsDir: '.claude/skills' | '.agents/skills' = '.agents/skills',
): Promise<Record<string, string>> {
  // Skills are opt-in: if no selection provided or empty, inject nothing
  if (!selectedSkillNames || selectedSkillNames.length === 0) {
    return {};
  }

  const skills = await fetchOrgSkills(organizationId);
  const files: Record<string, string> = {};
  const selectedSet = new Set(selectedSkillNames.map((n) => n.trim().toLowerCase()));

  for (const skill of skills) {
    if (selectedSet.has(skill.name.toLowerCase())) {
      files[`${skillsDir}/${skill.name}/SKILL.md`] = generateSkillMd(skill);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Budget enforcement helpers
// ---------------------------------------------------------------------------

const BUDGET_EXCEEDED_PATTERNS = [
  'budget exceeded',
  'exceeded budget',
  'ExceededBudget',
  'Budget has been exceeded',
];

/**
 * Detect if an error is a LiteLLM budget-exceeded rejection.
 * LiteLLM returns HTTP 400 with a message containing "budget exceeded".
 */
export function isBudgetExceededError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return BUDGET_EXCEEDED_PATTERNS.some((p) => message.toLowerCase().includes(p.toLowerCase()));
}

export const BUDGET_EXCEEDED_USER_MESSAGE =
  'Your organization has reached its AI usage budget for this billing period. ' +
  'Please upgrade your plan or wait for the next billing cycle to continue using AI features.';

export function combineHeaders(
  ...sources: (Record<string, string> | undefined)[]
): Record<string, string> {
  return sources.reduce<Record<string, string>>((acc, source) => {
    if (!source) {
      return acc;
    }
    for (const [key, value] of Object.entries(source)) {
      const trimmedKey = key.trim();
      const trimmedValue = value.trim();
      if (trimmedKey.length > 0 && trimmedValue.length > 0) {
        acc[trimmedKey] = trimmedValue;
      }
    }
    return acc;
  }, {});
}
