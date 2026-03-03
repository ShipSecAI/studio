import { ConfigurationError } from '@shipsec/component-sdk';
import { getBackendApiV1Url } from '../../utils/backend-url';

export const DEFAULT_API_BASE_URL = getBackendApiV1Url({ preferDockerHost: true });

export const DEFAULT_GATEWAY_URL = `${DEFAULT_API_BASE_URL}/mcp/gateway`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getGatewaySessionToken(
  runId: string,
  organizationId: string | null,
  connectedToolNodeIds?: string[],
): Promise<string> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set for agent tool discovery',
      { configKey: 'INTERNAL_SERVICE_TOKEN' },
    );
  }

  const url = `${DEFAULT_API_BASE_URL}/internal/mcp/generate-token`;
  // If connectedToolNodeIds is empty or undefined, we might still want to generate a token
  // without specific allowedNodeIds if the API supports it, or handle it otherwise.
  // The original code passed `allowedNodeIds: connectedToolNodeIds`.
  const body = { runId, organizationId, allowedNodeIds: connectedToolNodeIds };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate gateway session token: ${errorText}`);
  }

  const payload = await response.json();
  const token = isRecord(payload) && typeof payload.token === 'string' ? payload.token : null;
  if (!token) {
    throw new Error('Failed to generate gateway session token: invalid response shape');
  }
  return token;
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

  const baseUrl =
    backendUrl ??
    process.env.STUDIO_API_BASE_URL ??
    process.env.SHIPSEC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:3211/api/v1';

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) return null;

  try {
    const res = await fetch(
      `${baseUrl}/internal/billing/litellm-key?organizationId=${encodeURIComponent(orgId)}`,
      {
        headers: {
          'x-internal-token': internalToken,
        },
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { virtualKey?: string | null };
    if (!data.virtualKey) return null;

    virtualKeyCache.set(orgId, data.virtualKey);
    return data.virtualKey;
  } catch {
    return null;
  }
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
