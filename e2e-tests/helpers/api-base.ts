const DEFAULT_INSTANCE = 0;
const BACKEND_BASE_PORT = 3211;

function readInstance(): number {
  const raw = process.env.E2E_INSTANCE ?? process.env.SHIPSEC_INSTANCE ?? String(DEFAULT_INSTANCE);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return DEFAULT_INSTANCE;
  }
  return parsed;
}

export function getE2EInstance(): number {
  return readInstance();
}

export function getBackendPortForInstance(instance: number): number {
  return BACKEND_BASE_PORT + instance * 100;
}

export function getApiBaseUrl(): string {
  const instance = getE2EInstance();
  const port = getBackendPortForInstance(instance);
  return `http://127.0.0.1:${port}/api/v1`;
}

