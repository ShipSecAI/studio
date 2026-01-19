import { useAuth } from '../../auth/auth-context';

// Hook to check if current user has required permissions
export function usePermissions() {
  const { user, isAuthenticated } = useAuth();

  const hasRole = (requiredRoles: string[]) => {
    if (!isAuthenticated || !user) return false;

    const userRole = user.organizationRole?.toUpperCase();
    return requiredRoles.some((role) => userRole === role.toUpperCase() || role === '*');
  };

  const hasOrg = () => {
    return isAuthenticated && user && !!user.organizationId;
  };

  const canAccess = (
    options: {
      requireAuth?: boolean;
      requireOrg?: boolean;
      roles?: string[];
    } = {},
  ) => {
    const { requireAuth = true, requireOrg = false, roles = [] } = options;

    if (requireAuth && !isAuthenticated) return false;
    if (requireOrg && !hasOrg()) return false;
    if (roles.length > 0 && !hasRole(roles)) return false;

    return true;
  };

  return {
    user,
    isAuthenticated,
    hasRole,
    hasOrg,
    canAccess,
  };
}
