import type { ReactNode } from 'react';
import { useFeatureFlag, useFeatureFlagContext } from './FeatureFlagProvider';
import type { FeatureKey } from './types';

interface FeatureGateProps {
  /** The feature flag to check */
  flag: FeatureKey;
  children: ReactNode;
  /** Rendered when the flag is disabled */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on a feature flag.
 *
 * ```tsx
 * <FeatureGate flag="AI_AGENT" fallback={<UpgradeBanner />}>
 *   <ChatInterface />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const enabled = useFeatureFlag(flag);
  return <>{enabled ? children : fallback}</>;
}

interface MultiFeatureGateProps {
  /** All flags that must be enabled (mode='all') or any one (mode='any') */
  flags: FeatureKey[];
  children: ReactNode;
  fallback?: ReactNode;
  /** 'all' = every flag must be on. 'any' = at least one. Default: 'all' */
  mode?: 'all' | 'any';
}

/**
 * Gate that checks multiple flags at once.
 *
 * ```tsx
 * <MultiFeatureGate flags={['GITHUB_INTEGRATION', 'CODE_SCANS']} mode="all">
 *   <ScanResults />
 * </MultiFeatureGate>
 * ```
 */
export function MultiFeatureGate({
  flags: keys,
  children,
  fallback = null,
  mode = 'all',
}: MultiFeatureGateProps) {
  const { flags } = useFeatureFlagContext();
  const enabled = mode === 'all' ? keys.every((k) => flags[k]) : keys.some((k) => flags[k]);

  return <>{enabled ? children : fallback}</>;
}
