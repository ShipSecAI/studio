import { createRequire } from 'node:module';
import type { ProviderOverrides } from '@shipsec/shared';

type OverridesFactory = () => ProviderOverrides;

function readOverrideModulePath(): string | null {
  const fromProviders = process.env.SHIPSEC_PROVIDER_OVERRIDES_MODULE?.trim();
  if (fromProviders) return fromProviders;
  const legacyBackend = process.env.SHIPSEC_CLOUD_BACKEND_MODULE?.trim();
  if (legacyBackend) return legacyBackend;
  return null;
}

function resolveOverridesFactory(mod: unknown): OverridesFactory | null {
  if (mod && typeof mod === 'object') {
    const moduleRecord = mod as Record<string, unknown>;
    const modern = moduleRecord.createProviderOverrides;
    if (typeof modern === 'function') return modern as OverridesFactory;

    const legacyBackend = moduleRecord.createBackendProviderOverrides;
    if (typeof legacyBackend === 'function') return legacyBackend as OverridesFactory;
  }
  return null;
}

export function loadProviderOverrides(): ProviderOverrides {
  const modulePath = readOverrideModulePath();
  if (!modulePath) return {};

  try {
    const req = createRequire(import.meta.url);
    const loaded = req(modulePath) as unknown;
    const factory = resolveOverridesFactory(loaded);
    if (!factory) {
      console.warn(
        `[providers] Override module "${modulePath}" loaded but no createProviderOverrides export was found.`,
      );
      return {};
    }

    const overrides = factory();
    return overrides ?? {};
  } catch (error) {
    console.warn(
      `[providers] Failed to load provider overrides from "${modulePath}": ${String(error)}`,
    );
    return {};
  }
}
