import { Navigate, Outlet } from 'react-router-dom';
import { useFeatureFlag } from './FeatureFlagProvider';
import type { FeatureKey } from './types';

interface FeatureFlagRouteProps {
  /** The flag that must be enabled for child routes to render */
  flag: FeatureKey;
  /** Where to redirect when the flag is disabled. Default: "/" */
  redirectTo?: string;
}

/**
 * Route-level guard. Use as a layout route to protect entire route sections.
 *
 * ```tsx
 * <Route element={<FeatureFlagRoute flag="CLOUD_SECURITY" />}>
 *   <Route path="/cloud/accounts" element={<CloudAccountsPage />} />
 *   <Route path="/cloud/inventory" element={<CloudInventoryPage />} />
 * </Route>
 * ```
 */
export function FeatureFlagRoute({ flag, redirectTo = '/' }: FeatureFlagRouteProps) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <Outlet /> : <Navigate to={redirectTo} replace />;
}
