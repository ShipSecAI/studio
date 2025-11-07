import React, { useEffect } from 'react';
import { useAuth, useAuthProvider } from '../../auth/auth-context';
import { AuthModal, useAuthModal } from './AuthModal';
import { AdminLoginForm } from './AdminLoginForm';
import { Button } from '../ui/button';
import { Shield, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useAuthStore } from '../../store/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAuth?: boolean;
  requireOrg?: boolean;
  roles?: string[];
  redirectTo?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  fallback,
  requireAuth = true,
  requireOrg = false,
  roles = [],
  redirectTo,
}) => {
  // All hooks must be called unconditionally at the top
  const { isAuthenticated, isLoading, user } = useAuth();
  const authProvider = useAuthProvider();
  const { openSignIn, isOpen, close } = useAuthModal();
  const adminUsername = useAuthStore((state) => state.adminUsername);
  const adminPassword = useAuthStore((state) => state.adminPassword);

  // Automatically trigger sign-in for Clerk when not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated && requireAuth && authProvider.name === 'clerk') {
      // Use Clerk's sign-in directly instead of modal
      authProvider.signIn();
    }
  }, [isLoading, isAuthenticated, requireAuth, authProvider]);

  // Compute derived values after hooks
  const isLocalAuth = authProvider.name === 'local';
  const hasLocalCredentials = !!(adminUsername && adminPassword);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <Shield className="w-6 h-6 animate-pulse" />
          <span>Checking authentication...</span>
        </div>
      </div>
    );
  }

  // Custom fallback component if provided
  if (fallback && !isAuthenticated && requireAuth) {
    return <>{fallback}</>;
  }

  // If using local auth and no credentials, show login form
  if (isLocalAuth && !hasLocalCredentials && requireAuth) {
    return <AdminLoginForm />;
  }

  // Default authentication required flow
  if (!isAuthenticated && requireAuth) {
    // For Clerk, the sign-in modal is already triggered by useEffect above
    // For other providers, show the auth modal button
    if (authProvider.name === 'clerk') {
      return (
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-6 w-6" />
              </div>
              <CardTitle>Authentication Required</CardTitle>
              <CardDescription>
                Please sign in to continue
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Opening sign-in dialog...
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-6 w-6" />
              </div>
              <CardTitle>Authentication Required</CardTitle>
              <CardDescription>
                Please sign in to access this content
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={openSignIn} className="w-full">
                Sign In
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                You'll be redirected back after signing in
              </p>
            </CardContent>
          </Card>
        </div>
        <AuthModal
          isOpen={isOpen}
          onClose={close}
          afterSignInUrl={redirectTo || window.location.pathname}
        />
      </>
    );
  }

  // Check if organization membership is required
  if (requireOrg && isAuthenticated && user && !user.organizationId) {
    return (
      <div className="flex items-center justify-center min-h-96 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Shield className="h-6 w-6" />
            </div>
            <CardTitle>Organization Required</CardTitle>
            <CardDescription>
              You need to be a member of an organization to access this content
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-center text-muted-foreground">
              Please contact your administrator to be added to an organization
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check role requirements
  if (roles.length > 0 && isAuthenticated && user) {
    const userRole = user.organizationRole?.toUpperCase();
    const hasRequiredRole = roles.some(role =>
      userRole === role.toUpperCase() || role === '*'
    );

    if (!hasRequiredRole) {
      return (
        <div className="flex items-center justify-center min-h-96 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-6 w-6" />
              </div>
              <CardTitle>Insufficient Permissions</CardTitle>
              <CardDescription>
                You don't have the required permissions to access this content
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-center text-muted-foreground">
                Required roles: {roles.join(', ')}
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  // All checks passed - render children
  return <>{children}</>;
};

// Higher-order component for protecting routes
export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
  options: Omit<ProtectedRouteProps, 'children'> = {}
) {
  const WrappedComponent = (props: P) => (
    <ProtectedRoute {...options}>
      <Component {...props} />
    </ProtectedRoute>
  );

  WrappedComponent.displayName = `withAuth(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

// Hook to check if current user has required permissions
export function usePermissions() {
  const { user, isAuthenticated } = useAuth();

  const hasRole = (requiredRoles: string[]) => {
    if (!isAuthenticated || !user) return false;

    const userRole = user.organizationRole?.toUpperCase();
    return requiredRoles.some(role =>
      userRole === role.toUpperCase() || role === '*'
    );
  };

  const hasOrg = () => {
    return isAuthenticated && user && !!user.organizationId;
  };

  const canAccess = (options: {
    requireAuth?: boolean;
    requireOrg?: boolean;
    roles?: string[];
  } = {}) => {
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