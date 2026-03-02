import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import posthog from 'posthog-js';
import type { FeatureKey, ResolvedFlags } from './types';
import { featureRegistry } from './registry';
import { resolveFeatureFlags } from './resolver';

const CACHE_KEY = 'shipsec_feature_flags';

interface FeatureFlagContextValue {
  flags: ResolvedFlags;
  loading: boolean;
  /** Force-refresh flags from PostHog */
  refresh: () => void;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

/** Build default flags from the registry (all defaults, no remote overrides) */
function buildDefaultFlags(): ResolvedFlags {
  return resolveFeatureFlags(featureRegistry, {});
}

/** Read cached flags from sessionStorage to avoid layout shift */
function readCachedFlags(): ResolvedFlags | null {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ResolvedFlags;
  } catch {
    // ignore
  }
  return null;
}

/** Persist resolved flags to sessionStorage */
function writeCachedFlags(flags: ResolvedFlags) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

/** Read PostHog feature flags and merge with registry defaults */
function readPostHogFlags(): Partial<Record<FeatureKey, boolean>> {
  const raw: Partial<Record<FeatureKey, boolean>> = {};

  for (const def of Object.values(featureRegistry)) {
    try {
      const value = posthog.isFeatureEnabled(def.posthogKey);
      // PostHog returns undefined for unknown flags — skip those so defaults apply
      if (typeof value === 'boolean') {
        raw[def.key] = value;
      }
    } catch {
      // PostHog not initialised yet — skip
    }
  }

  return raw;
}

interface FeatureFlagProviderProps {
  children: ReactNode;
  /** Poll interval in ms. 0 = no polling (flags update on PostHog events). Default: 0 */
  pollInterval?: number;
}

export function FeatureFlagProvider({ children, pollInterval = 0 }: FeatureFlagProviderProps) {
  // Initialise from cache (instant, no layout shift) → then from defaults
  const [flags, setFlags] = useState<ResolvedFlags>(() => readCachedFlags() ?? buildDefaultFlags());
  const [loading, setLoading] = useState(true);

  const evaluate = useCallback(() => {
    const raw = readPostHogFlags();
    const resolved = resolveFeatureFlags(featureRegistry, raw);
    writeCachedFlags(resolved);
    setFlags(resolved);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Evaluate once PostHog has loaded its flags
    if (posthog.__loaded) {
      posthog.onFeatureFlags(() => evaluate());
    }

    // Also evaluate immediately in case flags are already cached locally by PostHog
    evaluate();

    // Optional polling for near-real-time kill-switch
    if (pollInterval > 0) {
      const id = setInterval(() => {
        posthog.reloadFeatureFlags();
      }, pollInterval);
      return () => clearInterval(id);
    }
  }, [evaluate, pollInterval]);

  const value = useMemo<FeatureFlagContextValue>(
    () => ({ flags, loading, refresh: () => posthog.reloadFeatureFlags() }),
    [flags, loading],
  );

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

// ── Hooks ────────────────────────────────────────────────────────

export function useFeatureFlagContext(): FeatureFlagContextValue {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    throw new Error('useFeatureFlagContext must be used within <FeatureFlagProvider>');
  }
  return ctx;
}

/** Returns `true` if the given feature flag is enabled (with dependency resolution). */
export function useFeatureFlag(flag: FeatureKey): boolean {
  const { flags } = useFeatureFlagContext();
  return flags[flag] ?? false;
}

/** Returns resolved states for multiple flags at once. */
export function useFeatureFlags(...keys: FeatureKey[]): Record<FeatureKey, boolean> {
  const { flags } = useFeatureFlagContext();
  const result = {} as Record<FeatureKey, boolean>;
  for (const k of keys) {
    result[k] = flags[k] ?? false;
  }
  return result;
}

/** Returns all resolved flags. */
export function useAllFeatureFlags(): ResolvedFlags {
  const { flags } = useFeatureFlagContext();
  return flags;
}
