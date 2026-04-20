import { createRequire } from 'node:module';
import type { ProviderOverrides } from '@shipsec/shared';

type OverridesFactory = () => ProviderOverrides;

function readOverrideModulePath(): string | null {
  const fromProviders = process.env.SHIPSEC_PROVIDER_OVERRIDES_MODULE?.trim();
  if (fromProviders) return fromProviders;
  const workerSpecific = process.env.SHIPSEC_WORKER_PROVIDER_OVERRIDES_MODULE?.trim();
  if (workerSpecific) return workerSpecific;
  const legacyWorker = process.env.SHIPSEC_CLOUD_WORKER_MODULE?.trim();
  if (legacyWorker) return legacyWorker;
  return null;
}

function resolveOverridesFactory(mod: unknown): OverridesFactory | null {
  if (mod && typeof mod === 'object') {
    const moduleRecord = mod as Record<string, unknown>;
    const modern = moduleRecord.createProviderOverrides;
    if (typeof modern === 'function') return modern as OverridesFactory;

    const legacyWorker = moduleRecord.createWorkerProviderOverrides;
    if (typeof legacyWorker === 'function') return legacyWorker as OverridesFactory;
  }
  return null;
}

export function loadWorkerProviderOverrides(): ProviderOverrides {
  const modulePath = readOverrideModulePath();
  if (!modulePath) return {};

  try {
    const req = createRequire(import.meta.url);
    const loaded = req(modulePath) as unknown;
    const factory = resolveOverridesFactory(loaded);
    if (!factory) {
      console.warn(
        `[providers] Worker override module "${modulePath}" loaded but no createProviderOverrides export was found.`,
      );
      return {};
    }

    const overrides = factory();
    return overrides ?? {};
  } catch (error) {
    console.warn(
      `[providers] Failed to load worker provider overrides from "${modulePath}": ${String(error)}`,
    );
    return {};
  }
}
