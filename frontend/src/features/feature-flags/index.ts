// Public API for the feature-flags module
export type { FeatureKey, FeatureDefinition, ResolvedFlags } from './types';
export { featureRegistry } from './registry';
export { resolveFeatureFlags, getBlockedFeatures } from './resolver';
export {
  FeatureFlagProvider,
  useFeatureFlag,
  useFeatureFlags,
  useAllFeatureFlags,
  useFeatureFlagContext,
} from './FeatureFlagProvider';
export { FeatureGate, MultiFeatureGate } from './FeatureGate';
export { FeatureFlagRoute } from './FeatureFlagRoute';
