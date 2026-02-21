const DEFAULT_INSTANCE = 0;
const BACKEND_BASE_PORT = 3211;
const FRONTEND_BASE_PORT = 5173;

function getInstance(): number {
  const raw = process.env.SHIPSEC_INSTANCE ?? String(DEFAULT_INSTANCE);
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_INSTANCE : parsed;
}

export function getApiBaseUrl(): string {
  const instance = getInstance();
  const port = BACKEND_BASE_PORT + instance * 100;
  return `http://127.0.0.1:${port}/api/v1`;
}

export function getFrontendBaseUrl(): string {
  const instance = getInstance();
  const port = FRONTEND_BASE_PORT + instance * 100;
  return `http://localhost:${port}`;
}

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
  'Authorization': `Basic ${btoa('admin:admin')}`,
};

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
}

export async function apiRequest<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const init: RequestInit = {
    headers: HEADERS,
    method: options?.method ?? 'GET',
  };
  if (options?.body) {
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`API ${init.method} ${url} failed: ${res.status} ${res.statusText}`);
  }
  // Handle 204 No Content
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function waitForPageReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Wait for loading skeletons to disappear
  const skeletons = page.locator('[data-slot="skeleton"], .animate-pulse');
  if (await skeletons.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await skeletons.first().waitFor({ state: 'hidden', timeout: 15_000 });
  }
}

export async function healthCheck(): Promise<void> {
  const backendUrl = `${getApiBaseUrl()}/health`;
  const frontendUrl = getFrontendBaseUrl();

  const checkBackend = fetch(backendUrl, {
    signal: AbortSignal.timeout(5_000),
    headers: {
      ...HEADERS,
      'Authorization': `Basic ${btoa('admin:admin')}`,
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`Backend health check failed: ${r.status}`);
  });

  const checkFrontend = fetch(frontendUrl, {
    signal: AbortSignal.timeout(5_000),
  }).then((r) => {
    if (!r.ok) throw new Error(`Frontend health check failed: ${r.status}`);
  });

  await Promise.all([checkBackend, checkFrontend]);
}
