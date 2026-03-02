import type { FeatureKey, FeatureRegistry, ResolvedFlags } from './types';

/**
 * Resolves feature flags considering the dependency DAG.
 *
 * A feature is enabled only when:
 *   1. Its raw value (from PostHog / defaults) is true, AND
 *   2. Every feature in its `dependsOn` chain is also enabled.
 *
 * Uses DFS with memoisation. Circular dependencies resolve to `false`.
 */
export function resolveFeatureFlags(
  registry: FeatureRegistry,
  rawFlags: Partial<Record<FeatureKey, boolean>>,
): ResolvedFlags {
  const resolved: Partial<ResolvedFlags> = {};
  const visiting = new Set<FeatureKey>();

  function resolve(key: FeatureKey): boolean {
    if (key in resolved) return resolved[key]!;

    // Circular dependency guard
    if (visiting.has(key)) {
      console.warn(`[feature-flags] Circular dependency at: ${key}`);
      return false;
    }

    const def = registry[key];
    if (!def) return false;

    visiting.add(key);

    // Start with the raw flag value, falling back to the registry default
    let enabled = rawFlags[key] ?? def.defaultEnabled;

    // If enabled, verify all parents are also enabled
    if (enabled && def.dependsOn) {
      for (const parent of def.dependsOn) {
        if (!resolve(parent)) {
          enabled = false;
          break;
        }
      }
    }

    visiting.delete(key);
    resolved[key] = enabled;
    return enabled;
  }

  for (const key of Object.keys(registry) as FeatureKey[]) {
    resolve(key);
  }

  return resolved as ResolvedFlags;
}

/**
 * Returns every feature key that would be disabled if `key` were turned off.
 * Useful for showing "disabling X will also disable Y, Z" warnings in an admin UI.
 */
export function getBlockedFeatures(key: FeatureKey, registry: FeatureRegistry): FeatureKey[] {
  const blocked: FeatureKey[] = [];
  const seen = new Set<FeatureKey>();

  function collect(parent: FeatureKey) {
    for (const [k, def] of Object.entries(registry) as [
      FeatureKey,
      (typeof registry)[FeatureKey],
    ][]) {
      if (def.dependsOn?.includes(parent) && !seen.has(k)) {
        seen.add(k);
        blocked.push(k);
        collect(k);
      }
    }
  }

  collect(key);
  return blocked;
}
